using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace MacroStudio
{
    public class MainWindow : Window
    {
        private readonly Grid rootGrid;
        private readonly WebView2 webView;
        private Border loadingOverlay;
        private HostServices hostServices;
        private MessageRouter messageRouter;

        // The three colours of the mark on the loading screen, kept here
        // so the taskbar button and the splash are the same object rather
        // than two things that merely look alike.
        private static readonly Color MarkPlate = Color.FromRgb(30, 41, 59);
        private static readonly Color MarkEdge = Color.FromRgb(51, 65, 85);
        private static readonly Color MarkText =
            Color.FromRgb(125, 172, 255);

        public MainWindow()
        {
            Title = "MacroStudio beta 1.1.1-audit.1";
            // Without this the window and its taskbar button show the
            // icon of whatever process is hosting it, which is
            // powershell.exe.
            Icon = CreateWindowIcon();
            Rect workArea = SystemParameters.WorkArea;
            Width = Math.Min(1200, workArea.Width);
            Height = Math.Min(740, workArea.Height);
            MinWidth = Math.Min(760, workArea.Width);
            MinHeight = Math.Min(480, workArea.Height);
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            Background = new SolidColorBrush(Color.FromRgb(20, 22, 28));
            AllowDrop = true;

            rootGrid = new Grid();
            rootGrid.AllowDrop = true;

            webView = new WebView2();
            // The WebView2 child window owns the whole client area, so it
            // receives every external drop before WPF can. External drops
            // must stay enabled for the page to see them; the page turns
            // them into host requests carrying the real file paths.
            webView.AllowExternalDrop = true;
            webView.AllowDrop = true;
            webView.DefaultBackgroundColor = System.Drawing.Color.FromArgb(20, 22, 28);
            webView.Visibility = Visibility.Hidden;
            rootGrid.Children.Add(webView);

            loadingOverlay = CreateLoadingOverlay();
            rootGrid.Children.Add(loadingOverlay);
            Content = rootGrid;

            AddHandler(
                DragDrop.PreviewDragOverEvent,
                new DragEventHandler(OnPreviewDragOver),
                true);
            AddHandler(
                DragDrop.PreviewDropEvent,
                new DragEventHandler(OnPreviewDrop),
                true);

            Loaded += OnLoaded;
            Closing += OnClosing;
            Closed += OnClosed;
        }

        // The mark, drawn as shapes rather than loaded from an image
        // file: Windows asks for it at 16, 24, 32 and larger, and a
        // drawing answers every one of those without a set of bitmaps to
        // keep in step.
        public static ImageSource CreateWindowIcon()
        {
            const double Size = 64;
            DrawingGroup drawing = new DrawingGroup();
            SolidColorBrush textBrush = new SolidColorBrush(MarkText);
            RectangleGeometry plate = new RectangleGeometry(
                new Rect(1, 1, Size - 2, Size - 2),
                14,
                14);
            FormattedText text = new FormattedText(
                "MS",
                CultureInfo.InvariantCulture,
                FlowDirection.LeftToRight,
                new Typeface(
                    SystemFonts.MessageFontFamily,
                    FontStyles.Normal,
                    FontWeights.Bold,
                    FontStretches.Normal),
                // Sized so the two letters nearly span the plate: at the
                // 16px the taskbar starts from, anything smaller reads as
                // a blank tile.
                36,
                textBrush,
                1.0);

            drawing.Children.Add(new GeometryDrawing(
                new SolidColorBrush(MarkPlate),
                new Pen(new SolidColorBrush(MarkEdge), 2),
                plate));
            drawing.Children.Add(new GeometryDrawing(
                textBrush,
                null,
                text.BuildGeometry(new Point(
                    (Size - text.Width) / 2,
                    (Size - text.Height) / 2))));

            DrawingImage image = new DrawingImage(drawing);
            image.Freeze();
            return image;
        }

        // The first thing anyone sees. It is small and quiet: the mark,
        // the name, and one bar that keeps moving until the page is up.
        private Border CreateLoadingOverlay()
        {
            Border overlay = new Border();
            overlay.Background = new SolidColorBrush(
                Color.FromRgb(20, 22, 28));

            StackPanel stack = new StackPanel();
            stack.HorizontalAlignment = HorizontalAlignment.Center;
            stack.VerticalAlignment = VerticalAlignment.Center;

            Border mark = new Border();
            mark.Width = 46;
            mark.Height = 46;
            mark.CornerRadius = new CornerRadius(12);
            mark.HorizontalAlignment = HorizontalAlignment.Center;
            mark.Background = new SolidColorBrush(
                Color.FromRgb(30, 41, 59));
            mark.BorderBrush = new SolidColorBrush(
                Color.FromRgb(51, 65, 85));
            mark.BorderThickness = new Thickness(1);

            TextBlock initials = new TextBlock();
            initials.Text = "MS";
            initials.FontSize = 15;
            initials.FontWeight = FontWeights.Bold;
            initials.HorizontalAlignment = HorizontalAlignment.Center;
            initials.VerticalAlignment = VerticalAlignment.Center;
            initials.Foreground = new SolidColorBrush(
                Color.FromRgb(125, 172, 255));
            mark.Child = initials;
            stack.Children.Add(mark);

            TextBlock name = new TextBlock();
            name.Text = "MacroStudio";
            name.FontSize = 15;
            name.FontWeight = FontWeights.SemiBold;
            name.Margin = new Thickness(0, 16, 0, 0);
            name.HorizontalAlignment = HorizontalAlignment.Center;
            name.Foreground = new SolidColorBrush(
                Color.FromRgb(226, 232, 240));
            stack.Children.Add(name);

            TextBlock version = new TextBlock();
            version.Text = "beta 1.1.1-audit.1";
            version.FontSize = 11;
            version.Margin = new Thickness(0, 4, 0, 0);
            version.HorizontalAlignment = HorizontalAlignment.Center;
            version.Foreground = new SolidColorBrush(
                Color.FromRgb(110, 122, 143));
            stack.Children.Add(version);

            stack.Children.Add(CreateLoadingBar());
            overlay.Child = stack;
            return overlay;
        }

        // A short track with a lozenge sliding across it. No percentage
        // is claimed, because the wait is not measurable.
        private Border CreateLoadingBar()
        {
            Border track = new Border();
            track.Width = 132;
            track.Height = 3;
            track.Margin = new Thickness(0, 22, 0, 0);
            track.CornerRadius = new CornerRadius(2);
            track.HorizontalAlignment = HorizontalAlignment.Center;
            track.Background = new SolidColorBrush(
                Color.FromRgb(32, 38, 48));
            track.ClipToBounds = true;

            Border pill = new Border();
            pill.Width = 44;
            pill.Height = 3;
            pill.CornerRadius = new CornerRadius(2);
            pill.HorizontalAlignment = HorizontalAlignment.Left;
            pill.Background = new SolidColorBrush(
                Color.FromRgb(59, 130, 246));

            TranslateTransform slide = new TranslateTransform();
            pill.RenderTransform = slide;
            track.Child = pill;

            DoubleAnimation move = new DoubleAnimation();
            move.From = -44;
            move.To = 132;
            move.Duration = new Duration(TimeSpan.FromMilliseconds(1100));
            move.RepeatBehavior = RepeatBehavior.Forever;
            move.EasingFunction = new SineEase();
            slide.BeginAnimation(
                TranslateTransform.XProperty,
                move);

            return track;
        }

        private async void OnLoaded(object sender, RoutedEventArgs e)
        {
            try
            {
                string userDataFolder = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "MacroStudio",
                    "WebView2Cache");

                CoreWebView2Environment environment =
                    await CoreWebView2Environment.CreateAsync(null, userDataFolder, null);
                await webView.EnsureCoreWebView2Async(environment);

                webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                    WebViewSecurity.TrustedHost,
                    Path.Combine(App.BaseDir, "assets"),
                    CoreWebView2HostResourceAccessKind.Allow);

                hostServices = new HostServices(this, App.BaseDir);
                WriteLifecycleLog("startup");
                // The boundary is set before anything is loaded, so no
                // page ever runs under looser rules than the product's.
                WebViewSecurity.Apply(
                    webView.CoreWebView2,
                    WriteSecurityLog);
                messageRouter = new MessageRouter(
                    webView,
                    hostServices);
                webView.CoreWebView2.WebMessageReceived +=
                    messageRouter.OnWebMessageReceived;
                webView.CoreWebView2.NavigationCompleted += OnFirstNavigationCompleted;
                webView.CoreWebView2.Navigate(WebViewSecurity.StartPage);
            }
            catch (Exception ex)
            {
                Close();
                App.ShowStartupMessage("webview-init-error.txt", ex);
            }
        }

        private void OnClosing(
            object sender,
            System.ComponentModel.CancelEventArgs e)
        {
            if (messageRouter != null && messageRouter.IsEngineBusy)
            {
                e.Cancel = true;
                MessageBox.Show(this,
                    "ブックの読み込み・作成処理が実行中です。完了後に閉じてください。",
                    "MacroStudio", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }
            WriteLifecycleLog("shutdown");
        }

        private void OnClosed(object sender, EventArgs e)
        {
            if (webView.CoreWebView2 != null &&
                messageRouter != null)
            {
                webView.CoreWebView2.WebMessageReceived -=
                    messageRouter.OnWebMessageReceived;
            }
            webView.Dispose();
        }

        private void WriteSecurityLog(string message)
        {
            if (hostServices == null)
            {
                return;
            }

            try
            {
                hostServices.WriteLog("WARN", message);
            }
            catch
            {
            }
        }

        private void WriteLifecycleLog(string action)
        {
            if (hostServices == null)
            {
                return;
            }

            try
            {
                hostServices.WriteLog(
                    "INFO",
                    action + ": " + App.BaseDir);
            }
            catch
            {
            }
        }

        private void OnFirstNavigationCompleted(
            object sender,
            CoreWebView2NavigationCompletedEventArgs e)
        {
            webView.CoreWebView2.NavigationCompleted -= OnFirstNavigationCompleted;
            if (!e.IsSuccess)
            {
                App.ShowStartupMessage("webview-init-error.txt",
                    new IOException("The local application page failed to load: " +
                        e.WebErrorStatus.ToString()));
                Close();
                return;
            }
            Dispatcher.BeginInvoke(new Action(delegate()
            {
                webView.Visibility = Visibility.Visible;
                if (loadingOverlay != null)
                {
                    Border leaving = loadingOverlay;
                    DoubleAnimation fade = new DoubleAnimation();
                    fade.From = 1;
                    fade.To = 0;
                    fade.Duration = new Duration(
                        TimeSpan.FromMilliseconds(220));
                    fade.Completed += delegate(
                        object fadeSender,
                        EventArgs fadeArgs)
                    {
                        rootGrid.Children.Remove(leaving);
                    };
                    leaving.BeginAnimation(
                        UIElement.OpacityProperty,
                        fade);
                    loadingOverlay = null;
                }
            }));
        }

        private void OnPreviewDragOver(object sender, DragEventArgs e)
        {
            if (e.Data.GetDataPresent(DataFormats.FileDrop))
            {
                e.Effects = DragDropEffects.Copy;
                e.Handled = true;
            }
        }

        private void OnPreviewDrop(object sender, DragEventArgs e)
        {
            // Secondary route: drops that reach WPF instead of the page
            // (window chrome, or hosts where the page never sees them).
            if (!e.Data.GetDataPresent(DataFormats.FileDrop))
            {
                return;
            }

            e.Handled = true;
            string[] paths = e.Data.GetData(DataFormats.FileDrop) as string[];
            if (paths == null ||
                paths.Length == 0 ||
                messageRouter == null)
            {
                return;
            }

            Dictionary<string, object> data =
                new Dictionary<string, object>();
            data.Add("path", paths[0]);
            data.Add("paths", paths);
            messageRouter.PushEvent("bookDropped", data);
        }
    }
}
