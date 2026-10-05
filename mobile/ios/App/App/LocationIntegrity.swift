import Capacitor
import CoreLocation
import Foundation
import UIKit

/// One location fix plus a jailbreak check, for the clock-in screen
/// (src/lib/native.ts getNativeFix).
///
/// iOS gives no "mock location" flag: without a jailbreak the OS does not let
/// an app feed a fake GPS position, so is_mock is always false and the real
/// signal on iOS is whether the phone is jailbroken.
@objc(LocationIntegrity)
public class LocationIntegrity: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "LocationIntegrity"
    public let jsName = "LocationIntegrity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getFix", returnType: CAPPluginReturnPromise),
    ]

    private let manager = CLLocationManager()
    private var pendingCall: CAPPluginCall?

    @objc func getFix(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.pendingCall?.reject("Superseded by a newer request")
            self.pendingCall = call
            self.manager.delegate = self
            self.manager.desiredAccuracy = kCLLocationAccuracyBest
            if self.manager.authorizationStatus == .notDetermined {
                self.manager.requestWhenInUseAuthorization()
            }
            self.manager.requestLocation()
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let call = pendingCall, let loc = locations.last else { return }
        pendingCall = nil
        call.resolve([
            "lat": loc.coordinate.latitude,
            "lng": loc.coordinate.longitude,
            "accuracy_m": loc.horizontalAccuracy,
            "altitude": loc.verticalAccuracy >= 0 ? loc.altitude : NSNull(),
            "speed": loc.speed >= 0 ? loc.speed : NSNull(),
            "heading": loc.course >= 0 ? loc.course : NSNull(),
            "is_mock": false,
            "compromised": LocationIntegrity.isJailbroken(),
            "platform": "ios",
            "captured_at": ISO8601DateFormatter().string(from: loc.timestamp),
        ])
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        pendingCall?.reject("Could not read location: \(error.localizedDescription)")
        pendingCall = nil
    }

    static func isJailbroken() -> Bool {
        #if targetEnvironment(simulator)
            return false
        #else
            let paths = [
                "/Applications/Cydia.app",
                "/Library/MobileSubstrate/MobileSubstrate.dylib",
                "/bin/bash", "/usr/sbin/sshd", "/etc/apt", "/private/var/lib/apt/",
            ]
            for p in paths where FileManager.default.fileExists(atPath: p) { return true }
            if let url = URL(string: "cydia://package/com.example"), UIApplication.shared.canOpenURL(url) {
                return true
            }
            // A sandbox breach: a normal app cannot write outside its container.
            let probe = "/private/jailbreak_probe.txt"
            do {
                try "probe".write(toFile: probe, atomically: true, encoding: .utf8)
                try FileManager.default.removeItem(atPath: probe)
                return true
            } catch {
                return false
            }
        #endif
    }
}
