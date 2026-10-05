// Add this file to the iOS app target in Xcode (App/App group), alongside
// LocationIntegrity.m. It returns one location fix plus a jailbreak check.
//
// iOS gives no "mock location" flag: without a jailbreak, the OS does not let
// an app feed a fake GPS coordinate, so is_mock is always false and the real
// signal on iOS is whether the device is jailbroken.

import Capacitor
import CoreLocation
import Foundation
import UIKit

@objc(LocationIntegrity)
public class LocationIntegrity: CAPPlugin, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var pendingCall: CAPPluginCall?

    @objc func getFix(_ call: CAPPluginCall) {
        pendingCall = call
        DispatchQueue.main.async {
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
        let result: [String: Any] = [
            "lat": loc.coordinate.latitude,
            "lng": loc.coordinate.longitude,
            "accuracy_m": loc.horizontalAccuracy,
            "altitude": loc.verticalAccuracy >= 0 ? loc.altitude : NSNull(),
            "speed": loc.speed >= 0 ? loc.speed : NSNull(),
            "heading": loc.course >= 0 ? loc.course : NSNull(),
            // iOS exposes no mock-location flag.
            "is_mock": false,
            "compromised": LocationIntegrity.isJailbroken(),
            "platform": "ios",
            "captured_at": ISO8601DateFormatter().string(from: loc.timestamp),
        ]
        call.resolve(result)
        pendingCall = nil
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
