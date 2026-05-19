import AppKit
import ApplicationServices

final class PiWebMenuBarApp: NSObject, NSApplicationDelegate {
        private var statusItem: NSStatusItem?
        private var serverProcess: Process?
        private let port = "19200"

        func applicationDidFinishLaunching(_ notification: Notification) {
                setupMenu()
                startServer()
                requestAccessibility()
                openWeb()
        }

        func applicationWillTerminate(_ notification: Notification) {
                stopServer()
        }

        private func setupMenu() {
                let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
                item.button?.title = "pi"
                let menu = NSMenu()
                menu.autoenablesItems = false

                menu.addItem(menuItem("Open Pi Web", #selector(openWeb), "o"))
                menu.addItem(menuItem("Restart Server", #selector(restartServer), "r"))
                menu.addItem(NSMenuItem.separator())
                menu.addItem(menuItem("Request Accessibility Permission", #selector(requestAccessibility), "a"))
                menu.addItem(menuItem("Open Developer Tools Permission", #selector(openDeveloperToolsPermission), "d"))
                menu.addItem(menuItem("Install Command Line Tools", #selector(installCommandLineTools), "i"))
                menu.addItem(NSMenuItem.separator())
                menu.addItem(menuItem("Quit", #selector(quit), "q"))

                item.menu = menu
                statusItem = item
        }

        private func menuItem(_ title: String, _ action: Selector, _ keyEquivalent: String) -> NSMenuItem {
                let item = NSMenuItem(title: title, action: action, keyEquivalent: keyEquivalent)
                item.target = self
                return item
        }

        @objc private func openWeb() {
                if let url = URL(string: "http://localhost:" + port) {
                        NSWorkspace.shared.open(url)
                }
        }

        @objc private func restartServer() {
                stopServer()
                startServer()
                openWeb()
        }

        @objc private func requestAccessibility() {
                let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
                let options = [key: true] as CFDictionary
                _ = AXIsProcessTrustedWithOptions(options)
                if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
                        NSWorkspace.shared.open(url)
                }
        }

        @objc private func openDeveloperToolsPermission() {
                if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_DeveloperTools") {
                        NSWorkspace.shared.open(url)
                }
        }

        @objc private func installCommandLineTools() {
                let process = Process()
                process.executableURL = URL(fileURLWithPath: "/usr/bin/xcode-select")
                process.arguments = ["--install"]
                try? process.run()
                openDeveloperToolsPermission()
        }

        @objc private func quit() {
                NSApp.terminate(nil)
        }

        private func startServer() {
                if serverProcess?.isRunning == true {
                        return
                }

                let macOsDir = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS")
                let process = Process()
                process.executableURL = macOsDir.appendingPathComponent("pi")
                process.arguments = ["web", "--port", port]
                process.currentDirectoryURL = macOsDir

                var env = ProcessInfo.processInfo.environment
                env["PI_PACKAGE_DIR"] = macOsDir.path
                process.environment = env

                do {
                        try process.run()
                        serverProcess = process
                } catch {
                        NSLog("Failed to start pi web: \(error)")
                }
        }

        private func stopServer() {
                guard let process = serverProcess else {
                        return
                }

                if process.isRunning {
                        process.terminate()
                }
                serverProcess = nil
        }
}

@main
enum PiWebMenuBarMain {
        private static let delegate = PiWebMenuBarApp()

        static func main() {
                let app = NSApplication.shared
                app.setActivationPolicy(.accessory)
                app.delegate = delegate
                app.run()
        }
}
