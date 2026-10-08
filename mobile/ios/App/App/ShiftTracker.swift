import Capacitor
import CoreLocation
import Foundation
import UIKit

/// Location for the length of a shift, with or without the app.
///
/// While Xtend is open or in the background, iOS keeps sending positions
/// (the blue location indicator shows meanwhile). After the person closes
/// the app, iOS no longer runs it continuously; instead "significant
/// location changes" wake it whenever the phone moves (about 500 m), and
/// it sends the position and carries on. That needs "Always" location
/// permission. Positions are kept on the phone first and sent straight to
/// the server with the phone's tracking token, so nothing depends on the
/// web page. The server's answer says when the shift is over.
final class ShiftTrackerCore: NSObject, CLLocationManagerDelegate {
    static let shared = ShiftTrackerCore()

    private let manager = CLLocationManager()
    private let defaults = UserDefaults.standard
    private let queueKey = "xtend.tracker.queue"
    private var sending = false
    private var lastFailure: Date?

    /// A position at least this often while standing still, sooner after a move.
    private let every: TimeInterval = 150
    private let movedMetres: CLLocationDistance = 100

    private override init() {
        super.init()
        manager.delegate = self
    }

    var token: String? { defaults.string(forKey: "xtend.tracker.token") }
    var endpoint: String? { defaults.string(forKey: "xtend.tracker.endpoint") }
    var expiresAt: Date? {
        let t = defaults.double(forKey: "xtend.tracker.expires")
        return t > 0 ? Date(timeIntervalSince1970: t / 1000) : nil
    }

    var configured: Bool {
        guard token != nil, endpoint != nil, let e = expiresAt else { return false }
        return e > Date()
    }

    var authorization: CLAuthorizationStatus { manager.authorizationStatus }

    func configure(token: String, endpoint: String, expiresAt: Double) {
        defaults.set(token, forKey: "xtend.tracker.token")
        defaults.set(endpoint, forKey: "xtend.tracker.endpoint")
        defaults.set(expiresAt, forKey: "xtend.tracker.expires")
    }

    /// Starts (or restarts, after iOS woke the app) the location services.
    func resume() {
        DispatchQueue.main.async {
            guard self.configured else {
                self.halt()
                return
            }
            if self.manager.authorizationStatus == .notDetermined {
                self.manager.requestWhenInUseAuthorization()
            } else if self.manager.authorizationStatus == .authorizedWhenInUse {
                // Shown once by iOS: "Change to Always Allow?"
                self.manager.requestAlwaysAuthorization()
            }
            self.manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
            self.manager.distanceFilter = 50
            self.manager.pausesLocationUpdatesAutomatically = false
            self.manager.activityType = .otherNavigation
            if Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes").map({ ($0 as? [String])?.contains("location") ?? false }) == true {
                self.manager.allowsBackgroundLocationUpdates = true
                self.manager.showsBackgroundLocationIndicator = true
            }
            self.manager.startUpdatingLocation()
            if CLLocationManager.significantLocationChangeMonitoringAvailable() {
                self.manager.startMonitoringSignificantLocationChanges()
            }
        }
    }

    func requestAlways() {
        DispatchQueue.main.async {
            if self.manager.authorizationStatus == .authorizedWhenInUse || self.manager.authorizationStatus == .notDetermined {
                self.manager.requestAlwaysAuthorization()
            } else if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
            }
        }
    }

    /// Forgets the token and stops every location service.
    func halt() {
        defaults.removeObject(forKey: "xtend.tracker.token")
        defaults.removeObject(forKey: "xtend.tracker.endpoint")
        defaults.removeObject(forKey: "xtend.tracker.expires")
        DispatchQueue.main.async {
            self.manager.stopUpdatingLocation()
            self.manager.stopMonitoringSignificantLocationChanges()
            self.manager.allowsBackgroundLocationUpdates = false
        }
    }

    var queued: Int { (defaults.array(forKey: queueKey) ?? []).count }
    var lastSentAt: Double { defaults.double(forKey: "xtend.tracker.sent") }
    var lastError: String? { defaults.string(forKey: "xtend.tracker.error") }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard configured else {
            halt()
            return
        }
        for l in locations { keep(l) }
        flush()
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        defaults.set("location: \(error.localizedDescription)", forKey: "xtend.tracker.error")
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if configured { resume() }
    }

    private func keep(_ l: CLLocation) {
        let now = Date()
        let lastAt = defaults.double(forKey: "xtend.tracker.lastAt")
        let last = CLLocation(latitude: defaults.double(forKey: "xtend.tracker.lastLat"),
                              longitude: defaults.double(forKey: "xtend.tracker.lastLng"))
        let due = lastAt == 0 || now.timeIntervalSince1970 - lastAt >= every || l.distance(from: last) >= movedMetres
        guard due, l.horizontalAccuracy >= 0 else { return }
        var queue = defaults.array(forKey: queueKey) as? [[String: Any]] ?? []
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        queue.append([
            "lat": l.coordinate.latitude,
            "lng": l.coordinate.longitude,
            "accuracy_m": l.horizontalAccuracy,
            "captured_at": f.string(from: min(l.timestamp, now)),
            "is_mock": false,
        ])
        if queue.count > 2000 { queue.removeFirst(queue.count - 2000) }
        defaults.set(queue, forKey: queueKey)
        defaults.set(now.timeIntervalSince1970, forKey: "xtend.tracker.lastAt")
        defaults.set(l.coordinate.latitude, forKey: "xtend.tracker.lastLat")
        defaults.set(l.coordinate.longitude, forKey: "xtend.tracker.lastLng")
    }

    /// Sends what is waiting. iOS gives a woken app about 30 seconds.
    func flush() {
        guard !sending, let token = token, let endpoint = endpoint, let url = URL(string: endpoint) else { return }
        if let failed = lastFailure, Date().timeIntervalSince(failed) < 60 { return }
        let queue = defaults.array(forKey: queueKey) as? [[String: Any]] ?? []
        guard !queue.isEmpty else { return }
        let batch = Array(queue.prefix(500))
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let body = try? JSONSerialization.data(withJSONObject: ["sent_at": f.string(from: Date()), "points": batch]) else { return }

        var request = URLRequest(url: url, timeoutInterval: 25)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = body

        sending = true
        var task: UIBackgroundTaskIdentifier = .invalid
        task = UIApplication.shared.beginBackgroundTask(withName: "xtend-positions") {
            UIApplication.shared.endBackgroundTask(task)
            task = .invalid
        }
        URLSession.shared.dataTask(with: request) { data, response, error in
            defer {
                self.sending = false
                if task != .invalid { UIApplication.shared.endBackgroundTask(task) }
            }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if error != nil || status == 0 {
                self.lastFailure = Date()
                self.defaults.set("network", forKey: "xtend.tracker.error")
                return
            }
            if status == 401 {
                self.defaults.set([], forKey: self.queueKey)
                self.halt()
                return
            }
            guard (200..<300).contains(status) else {
                self.lastFailure = Date()
                self.defaults.set("server \(status)", forKey: "xtend.tracker.error")
                return
            }
            let now = self.defaults.array(forKey: self.queueKey) as? [[String: Any]] ?? []
            self.defaults.set(Array(now.dropFirst(batch.count)), forKey: self.queueKey)
            self.defaults.set(Date().timeIntervalSince1970 * 1000, forKey: "xtend.tracker.sent")
            self.defaults.removeObject(forKey: "xtend.tracker.error")
            self.lastFailure = nil
            let answer = (data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
            if answer["stop"] as? Bool == true { self.halt() }
        }.resume()
    }
}

/// The web page's handle on the tracker (src/lib/native.ts).
@objc(ShiftTracker)
public class ShiftTracker: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShiftTracker"
    public let jsName = "ShiftTracker"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestBackground", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openBatterySettings", returnType: CAPPluginReturnPromise),
    ]

    @objc func start(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), let endpoint = call.getString("endpoint"),
              endpoint.hasPrefix("https://"), let expires = call.getDouble("expiresAt") else {
            call.reject("token, an https endpoint and expiresAt are needed")
            return
        }
        ShiftTrackerCore.shared.configure(token: token, endpoint: endpoint, expiresAt: expires)
        ShiftTrackerCore.shared.resume()
        call.resolve(state())
    }

    @objc func stop(_ call: CAPPluginCall) {
        ShiftTrackerCore.shared.halt()
        call.resolve(state())
    }

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(state())
    }

    @objc func requestBackground(_ call: CAPPluginCall) {
        ShiftTrackerCore.shared.requestAlways()
        call.resolve(state())
    }

    /// iPhones have no per-app battery restriction to lift.
    @objc func openBatterySettings(_ call: CAPPluginCall) {
        call.resolve(state())
    }

    private func state() -> [String: Any] {
        let core = ShiftTrackerCore.shared
        let auth = core.authorization
        var o: [String: Any] = [
            "platform": "ios",
            "active": core.configured,
            "running": core.configured,
            "location": auth == .authorizedAlways || auth == .authorizedWhenInUse,
            "always": auth == .authorizedAlways,
            "batteryUnrestricted": true,
            "queued": core.queued,
        ]
        if core.lastSentAt > 0 { o["lastSentAt"] = core.lastSentAt }
        if let e = core.lastError { o["lastError"] = e }
        return o
    }
}
