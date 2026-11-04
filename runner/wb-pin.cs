using System;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
public class WbPin {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")]
  private static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  private static void Pin(string title) {
    for (int i = 0; i < 100; i++) {
      IntPtr h = FindWindow(null, title);
      if (h != IntPtr.Zero) {
        // HWND_TOPMOST(-1), SWP_NOMOVE|SWP_NOSIZE|SWP_SHOWWINDOW (0x43).
        SetWindowPos(h, (IntPtr)(-1), 0, 0, 0, 0, 0x43);
        return;
      }
      System.Threading.Thread.Sleep(100);
    }
  }
  public static void PinAsync(string title) { Task.Run(() => Pin(title)); }
}
