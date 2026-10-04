// Prints the CoreGraphics window number of the first normal on-screen window owned by <pid>.
// Used to screenshot ONLY the Cairix window (never the whole desktop): screencapture -l <id>.
import CoreGraphics
import Foundation

guard CommandLine.arguments.count > 1, let pid = Int32(CommandLine.arguments[1]) else {
  FileHandle.standardError.write("usage: window-id <pid>\n".data(using: .utf8)!)
  exit(2)
}
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
for w in windows where (w[kCGWindowOwnerPID as String] as? Int32) == pid && (w[kCGWindowLayer as String] as? Int) == 0 {
  if let n = w[kCGWindowNumber as String] as? Int { print(n); exit(0) }
}
exit(1)
