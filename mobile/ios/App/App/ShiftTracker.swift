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
///
/// Follow live (migration 0070): while someone in the office follows this
/// person, the server's answer carries interval_ms (a few seconds). While
/// the app is open or in the background (standard location updates), the
/// tracker then asks for every movement at best accuracy and sends the
/// latest position with each request as "live" (shown to the follower,
/// never stored as a ping); stored positions keep their usual pace. It
/// goes back to normal when an answer comes without interval_ms, or after
/// a minute without one. With the app closed iOS only wakes it on
/// significant changes (about 500 m), so following is far coarser then.
final class ShiftTrackerCore: NSObject, CLLocationManagerDelegate {
    static let shared = ShiftTrackerCore()

    private let manager = CLLocationManager()
    private let defaults = UserDefaults.standard
    private let queueKey = "xtend.tracker.queue"
    private var sending = false
    private var lastFailure: Date?
    /// Follow live: the latest position, when one was last sent, and when
    /// the server was last asked anything.
    private var liveLocation: CLLocation?
    private var lastLiveAt: Date?
    private var lastCheck: Date?
    private var appliedFast = false

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
            self.applyAccuracy()
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

    /// Follow live: the fast interval in seconds while it holds, else nil.
    var fastInterval: TimeInterval? {
        let ms = defaults.double(forKey: "xtend.tracker.fastMs")
        let until = defaults.double(forKey: "xtend.tracker.fastUntil")
        guard ms >= 2000, until > Date().timeIntervalSince1970 else { return nil }
        return ms / 1000
    }

    /// Follow live: send every `ms` for the next minute (0: back to normal).
    func setFast(_ ms: Double) {
        if ms >= 2000 && ms <= 60000 {
            defaults.set(ms, forKey: "xtend.tracker.fastMs")
            defaults.set(Date().timeIntervalSince1970 + 60, forKey: "xtend.tracker.fastUntil")
        } else {
            defaults.removeObject(forKey: "xtend.tracker.fastMs")
            defaults.removeObject(forKey: "xtend.tracker.fastUntil")
        }
        DispatchQueue.main.async { self.applyAccuracy() }
    }

    /// Every movement at best accuracy while followed live; otherwise
    /// every 50 m at about 10 m. Main thread.
    private func applyAccuracy() {
        let fast = fastInterval != nil
        manager.desiredAccuracy = fast ? kCLLocationAccuracyBest : kCLLocationAccuracyNearestTenMeters
        manager.distanceFilter = fast ? kCLDistanceFilterNone : 50
        appliedFast = fast
    }

    /// Forgets the token and stops every location service.
    func halt() {
        defaults.removeObject(forKey: "xtend.tracker.fastMs")
        defaults.removeObject(forKey: "xtend.tracker.fastUntil")
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
        if (fastInterval != nil) != appliedFast { applyAccuracy() }
        if fastInterval != nil, let last = locations.last { liveLocation = last }
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
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        // Follow live: the latest position, at most once per interval.
        var live: [String: Any]? = nil
        if let fast = fastInterval, let l = liveLocation, Date().timeIntervalSince(l.timestamp) < 60,
           lastLiveAt.map({ Date().timeIntervalSince($0) >= fast - 0.5 }) ?? true {
            var point: [String: Any] = [
                "lat": l.coordinate.latitude,
                "lng": l.coordinate.longitude,
                "accuracy_m": max(l.horizontalAccuracy, 0),
                "captured_at": f.string(from: min(l.timestamp, Date())),
                "is_mock": false,
            ]
            if l.course >= 0 { point["heading"] = l.course }
            if l.speed >= 0 { point["speed"] = l.speed }
            live = point
        }
        // Now and then ask even with nothing to send, so a follow is noticed.
        let checkDue = lastCheck.map { Date().timeIntervalSince($0) >= 150 } ?? true
        guard !queue.isEmpty || live != nil || checkDue else { return }
        let batch = Array(queue.prefix(500))
        var payload: [String: Any] = ["sent_at": f.string(from: Date()), "points": batch]
        if let live = live {
            payload["live"] = live
            lastLiveAt = Date()
        }
        lastCheck = Date()
        guard let body = try? JSONSerialization.data(withJSONObject: payload) else { return }

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
            // Follow live: faster while the server asks, normal otherwise.
            self.setFast((answer["interval_ms"] as? NSNumber)?.doubleValue ?? 0)
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
        CAPPluginMethod(name: "follow", returnType: CAPPluginReturnPromise),
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

    /// Follow live (0070): send quick positions now rather than at the next
    /// answer from the server, which keeps it going and ends it.
    @objc func follow(_ call: CAPPluginCall) {
        let core = ShiftTrackerCore.shared
        let ms = call.getDouble("intervalMs") ?? 0
        guard core.configured, ms >= 2000, ms <= 60000 else {
            call.resolve(["ok": false])
            return
        }
        core.setFast(ms)
        core.flush()
        call.resolve(["ok": true])
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
