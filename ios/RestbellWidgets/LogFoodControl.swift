import SwiftUI
import WidgetKit
import AppIntents

/// Control Center, Lock Screen and Action Button control that opens the food logger.
struct LogFoodControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "LogFoodControl") {
            ControlWidgetButton(action: OpenFoodLoggerIntent()) {
                Label("Log Food", systemImage: "fork.knife")
            }
        }
        .displayName("Log Food")
        .description("Open Restbell ready to describe a meal.")
    }
}
