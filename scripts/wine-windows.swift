// Lists on-screen windows that belong to Wine (Windows programs): "id<TAB>w x h<TAB>title". Used by tests to screenshot only those windows.
import CoreGraphics
import Foundation
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]
for w in list {
  let owner = w[kCGWindowOwnerName as String] as? String ?? ""
  guard owner.lowercased().contains("wine") || owner.lowercased().hasSuffix(".exe") else { continue }
  let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
  let wd = b["Width"] as? Double ?? 0, ht = b["Height"] as? Double ?? 0
  if wd < 80 || ht < 60 { continue }
  print("\(w[kCGWindowNumber as String] as! Int)\t\(Int(wd))x\(Int(ht))\t\(owner)\t\(w[kCGWindowName as String] as? String ?? "")")
}
