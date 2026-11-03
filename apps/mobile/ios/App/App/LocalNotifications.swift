import Capacitor
import Foundation
import UserNotifications

/** A tap can launch the scene before Capacitor or its JavaScript listeners exist. */
enum LocalNotificationClicks {
    static let changed = Notification.Name("OctoBooksLocalNotificationClick")
    private static var pending: (sessionId: String, scope: String?)?
    private static var seenRequestIds: [String] = []

    static func validSessionId(_ value: String) -> Bool {
        value.range(of: "^[A-Za-z0-9_-]{1,64}$", options: .regularExpression) != nil
    }

    static func validScope(_ value: String) -> Bool {
        value.range(of: "^[A-Za-z0-9_:.-]{1,128}$", options: .regularExpression) != nil
    }

    static func record(_ response: UNNotificationResponse) {
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier,
              response.notification.request.identifier.hasPrefix("octobooks.response."),
              let sessionId = response.notification.request.content.userInfo["sessionId"] as? String,
              validSessionId(sessionId) else { return }
        let requestId = response.notification.request.identifier
        let scope = response.notification.request.content.userInfo["scope"] as? String
        if let raw = response.notification.request.content.userInfo["scope"],
           !(raw is String) || !validScope(scope ?? "") { return }
        DispatchQueue.main.async {
            // Cold-start scene options and the notification router may report the same tap.
            guard !seenRequestIds.contains(requestId) else { return }
            seenRequestIds.append(requestId)
            if seenRequestIds.count > 64 { seenRequestIds.removeFirst() }
            pending = (sessionId, scope)
            NotificationCenter.default.post(name: changed, object: nil)
        }
    }

    /** Access only from the main queue, as with record's state transition. */
    static func take() -> (sessionId: String, scope: String?)? {
        defer { pending = nil }
        return pending
    }
}

@objc(OctoNotificationsPlugin)
public final class OctoNotificationsPlugin: CAPPlugin, CAPBridgedPlugin, NotificationHandlerProtocol {
    public let identifier = "OctoNotificationsPlugin"
    public let jsName = "OctoNotifications"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "show", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takePendingClick", returnType: CAPPluginReturnPromise)
    ]
    private var clickObserver: NSObjectProtocol?

    public override func load() {
        // Capacitor remains UNUserNotificationCenter's delegate and continues routing push notifications.
        bridge?.notificationRouter.localNotificationHandler = self
        clickObserver = NotificationCenter.default.addObserver(
            forName: LocalNotificationClicks.changed, object: nil, queue: .main
        ) { [weak self] _ in
            self?.notifyListeners("notificationClick", data: [:])
        }
    }

    deinit {
        if let observer = clickObserver { NotificationCenter.default.removeObserver(observer) }
    }

    private static func permission(_ settings: UNNotificationSettings) -> String {
        switch settings.authorizationStatus {
        case .notDetermined: return "default"
        case .denied: return "denied"
        case .authorized, .provisional, .ephemeral: return "granted"
        @unknown default: return "denied"
        }
    }

    @objc public func status(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            call.resolve(["permission": Self.permission(settings)])
        }
    }

    @objc public func requestPermission(_ call: CAPPluginCall) {
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { _, error in
            if error != nil {
                call.reject("Could not request notification permission.")
                return
            }
            center.getNotificationSettings { settings in
                call.resolve(["permission": Self.permission(settings)])
            }
        }
    }

    @objc public func show(_ call: CAPPluginCall) {
        guard let sessionId = call.getString("sessionId"), LocalNotificationClicks.validSessionId(sessionId),
              let title = call.getString("title"), !title.isEmpty, title.utf16.count <= 120,
              let body = call.getString("body"), body.utf16.count <= 240 else {
            call.resolve(["shown": false])
            return
        }
        let scope = call.getString("scope")
        if call.options["scope"] != nil && (scope == nil || !LocalNotificationClicks.validScope(scope ?? "")) {
            call.resolve(["shown": false])
            return
        }
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            // Never ask permission as a side effect of response completion.
            guard Self.permission(settings) == "granted" else {
                call.resolve(["shown": false])
                return
            }
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = .default
            content.userInfo = ["sessionId": sessionId]
            if let scope = scope { content.userInfo["scope"] = scope }
            let request = UNNotificationRequest(
                identifier: "octobooks.response.\(UUID().uuidString)", content: content, trigger: nil
            )
            center.add(request) { error in call.resolve(["shown": error == nil]) }
        }
    }

    @objc public func takePendingClick(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let pending = LocalNotificationClicks.take() {
                var result: [String: Any] = ["sessionId": pending.sessionId]
                if let scope = pending.scope { result["scope"] = scope }
                call.resolve(result)
            } else {
                call.resolve([:])
            }
        }
    }

    public func willPresent(notification: UNNotification) -> UNNotificationPresentationOptions {
        guard notification.request.identifier.hasPrefix("octobooks.response.") else { return [] }
        return [.banner, .list, .sound]
    }

    public func didReceive(response: UNNotificationResponse) {
        LocalNotificationClicks.record(response)
    }
}
