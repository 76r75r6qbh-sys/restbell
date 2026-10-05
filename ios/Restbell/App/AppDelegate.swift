import UIKit
import UserNotifications
import RestbellKit

/// UIKit hooks SwiftUI doesn't cover: background tasks, HealthKit observers (both must be set up at launch),
/// notification taps and Home Screen quick actions.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        Background.register()
        UNUserNotificationCenter.current().delegate = Notifications.shared
        WorkoutIntentBridge.handler = { action in await AppModel.shared.workout.perform(action) }
        Task {
            await HealthSync.shared.start()
            Background.scheduleAll()
        }
        return true
    }

    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: nil, sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

/// Only here for quick actions; SwiftUI still owns the window.
final class SceneDelegate: NSObject, UIWindowSceneDelegate {
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        if let item = connectionOptions.shortcutItem {
            Task { @MainActor in QuickActions.handle(item) }
        }
    }

    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem) async -> Bool {
        await MainActor.run { QuickActions.handle(shortcutItem) }
        return true
    }
}
