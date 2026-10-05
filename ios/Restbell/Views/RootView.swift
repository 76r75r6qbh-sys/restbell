import SwiftUI
import RestbellKit

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        Group {
            if model.isSignedIn {
                TabView(selection: $model.tab) {
                    Tab("Today", systemImage: "sun.max", value: AppTab.today) { TodayView() }
                    Tab("Food", systemImage: "fork.knife", value: AppTab.food) { FoodView() }
                    Tab("Coach", systemImage: "bubble.left.and.text.bubble.right", value: AppTab.coach) { CoachView() }
                        .badge(model.summary?.unreadChat ?? 0)
                    Tab("More", systemImage: "ellipsis.circle", value: AppTab.more) { MoreView() }
                }
                .sheet(isPresented: $model.showLogFood) { LogFoodSheet() }
                .sheet(isPresented: $model.showWeighIn) { WeighInSheet() }
                .fullScreenCover(isPresented: $model.showSession) { SessionView() }
            } else {
                OnboardingView()
            }
        }
        .overlay(alignment: .top) {
            if let text = model.banner { BannerView(text: text) }
        }
        .animation(.spring(duration: 0.35), value: model.banner)
        .task {
            let args = ProcessInfo.processInfo.arguments
            if let i = args.firstIndex(of: "-screen"), i + 1 < args.count {
                await model.refresh()
                switch args[i + 1] {
                case "session":
                    if let today = model.today { try? await model.workout.start(today: today) }
                    model.showSession = true
                case "logFood": model.showLogFood = true
                default: break
                }
            }
        }
    }
}
