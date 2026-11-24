// Draws DropExe's app icon (1024x1024 PNG): a game card dropping into a glowing slot on a deep navy tile.
import AppKit
let size: CGFloat = 1024
let img = NSImage(size: NSSize(width: size, height: size))
img.lockFocus()
let ctx = NSGraphicsContext.current!.cgContext
let cs = CGColorSpaceCreateDeviceRGB()
let inset: CGFloat = 100
let rect = CGRect(x: inset, y: inset, width: size - inset * 2, height: size - inset * 2)
let tile = CGPath(roundedRect: rect, cornerWidth: 190, cornerHeight: 190, transform: nil)
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -14), blur: 40, color: NSColor(white: 0, alpha: 0.4).cgColor)
ctx.addPath(tile); ctx.setFillColor(NSColor.black.cgColor); ctx.fillPath()
ctx.restoreGState()
ctx.saveGState(); ctx.addPath(tile); ctx.clip()
let bg = CGGradient(colorsSpace: cs, colors: [
  NSColor(red: 0.12, green: 0.14, blue: 0.32, alpha: 1).cgColor,
  NSColor(red: 0.05, green: 0.06, blue: 0.13, alpha: 1).cgColor] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(bg, start: CGPoint(x: 0, y: size - inset), end: CGPoint(x: 0, y: inset), options: [])
// glow rising from the slot
let glow = CGGradient(colorsSpace: cs, colors: [NSColor(red: 0.45, green: 0.55, blue: 1, alpha: 0.75).cgColor, NSColor(red: 0.6, green: 0.35, blue: 1, alpha: 0).cgColor] as CFArray, locations: [0, 1])!
ctx.drawRadialGradient(glow, startCenter: CGPoint(x: 512, y: 250), startRadius: 0, endCenter: CGPoint(x: 512, y: 250), endRadius: 430, options: [])
ctx.restoreGState()
// the slot
ctx.setFillColor(NSColor(white: 1, alpha: 0.95).cgColor)
ctx.addPath(CGPath(roundedRect: CGRect(x: 262, y: 226, width: 500, height: 44), cornerWidth: 22, cornerHeight: 22, transform: nil)); ctx.fillPath()
// the card, tilted, half way into the slot
ctx.saveGState()
ctx.translateBy(x: 512, y: 520); ctx.rotate(by: -0.12)
let card = CGRect(x: -150, y: -215, width: 300, height: 430)
ctx.setShadow(offset: CGSize(width: 0, height: -20), blur: 50, color: NSColor(white: 0, alpha: 0.5).cgColor)
ctx.addPath(CGPath(roundedRect: card, cornerWidth: 46, cornerHeight: 46, transform: nil)); ctx.setFillColor(NSColor.white.cgColor); ctx.fillPath()
ctx.setShadow(offset: .zero, blur: 0, color: nil)
ctx.saveGState(); ctx.addPath(CGPath(roundedRect: card.insetBy(dx: 26, dy: 26), cornerWidth: 28, cornerHeight: 28, transform: nil)); ctx.clip()
let art = CGGradient(colorsSpace: cs, colors: [NSColor(red: 0.42, green: 0.58, blue: 1, alpha: 1).cgColor, NSColor(red: 0.66, green: 0.36, blue: 1, alpha: 1).cgColor, NSColor(red: 1, green: 0.42, blue: 0.62, alpha: 1).cgColor] as CFArray, locations: [0, 0.55, 1])!
ctx.drawLinearGradient(art, start: CGPoint(x: -150, y: 215), end: CGPoint(x: 150, y: -215), options: [])
ctx.restoreGState()
// play mark on the card
ctx.setFillColor(NSColor.white.cgColor)
ctx.move(to: CGPoint(x: -48, y: 72)); ctx.addLine(to: CGPoint(x: 78, y: 0)); ctx.addLine(to: CGPoint(x: -48, y: -72)); ctx.closePath(); ctx.fillPath()
ctx.restoreGState()
img.unlockFocus()
let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
