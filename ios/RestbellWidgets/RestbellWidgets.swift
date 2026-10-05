import SwiftUI
import WidgetKit

@main
struct RestbellWidgets: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        ProteinWidget()
        NextSessionWidget()
        RecoveryWidget()
        WorkoutLiveActivity()
        LogFoodControl()
    }
}
