# Diagnostic for the supplied sample fixtures only; not a general CFB validator.
# Uses Python standard library; does not execute VBA or modify workbooks.
import struct,zipfile,pathlib,hashlib,json

def streams(path):
 with zipfile.ZipFile(path) as z: b=z.read('xl/vbaProject.bin')
 assert b[:8]==bytes.fromhex('d0cf11e0a1b11ae1')
 sector=1<<struct.unpack_from('<H',b,30)[0]; mini=1<<struct.unpack_from('<H',b,32)[0]
 def block(s):return b[(s+1)*sector:(s+2)*sector]
 fat_sectors=list(struct.unpack_from('<109I',b,76)); nxt,count=struct.unpack_from('<II',b,68)
 for _ in range(count):
  a=struct.unpack('<%dI'%(sector//4),block(nxt));fat_sectors+=a[:-1];nxt=a[-1]
 fat=[]
 for s in fat_sectors:
  if s<0xfffffffa:fat.extend(struct.unpack('<%dI'%(sector//4),block(s)))
 def chain(start,table,read):
  parts=[];seen=set()
  while start<0xfffffffa:
   assert start not in seen;seen.add(start);parts.append(read(start));start=table[start]
  return b''.join(parts)
 d=chain(struct.unpack_from('<I',b,48)[0],fat,block)
 rec=[]
 for pos in range(0,len(d),128):
  n=struct.unpack_from('<H',d,pos+64)[0]; kind=d[pos+66]
  if not kind:continue
  rec.append((d[pos:pos+n-2].decode('utf-16le'),kind,*struct.unpack_from('<IQ',d,pos+116)))
 root=next(r for r in rec if r[1]==5); mini_root=chain(root[2],fat,block)[:root[3]]
 mini_data=chain(struct.unpack_from('<I',b,60)[0],fat,block)
 mini_fat=struct.unpack('<%dI'%(len(mini_data)//4),mini_data)
 result={}
 for name,kind,start,size in rec:
  if kind!=2:continue
  value=(chain(start,mini_fat,lambda s:mini_root[s*mini:(s+1)*mini]) if size<4096 else chain(start,fat,block))[:size]
  result[name]=value
 return result
root=pathlib.Path(__file__).resolve().parent.parent/'sample-book'
a=streams(root/'sample_win32_sleep.xlsm');b=streams(next(root.glob('**/*Modified*.xlsm')))
print(json.dumps({'original_header_hex':a['_VBA_PROJECT'][:7].hex(),'previous_output_header_hex':b['_VBA_PROJECT'][:7].hex(),'same_project_cache':a['_VBA_PROJECT']==b['_VBA_PROJECT'],'cache_length':len(a['_VBA_PROJECT']),'changed_existing_streams':[k for k in a if k in b and a[k]!=b[k]],'original_streams':{k:len(v) for k,v in a.items()}},indent=2,ensure_ascii=False))
