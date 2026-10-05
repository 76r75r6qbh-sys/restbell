import SwiftUI
import Charts
import RestbellKit

/// Minimal charts: no grid clutter, values on selection, one color per meaning.
struct TrendCharts: View {
    var page: MetricsPage
    var checkins: [Checkin]
    var runs: [Workout]

    struct Point: Identifiable {
        var date: Date
        var value: Double
        var series: String = ""
        var id: String { "\(series)\(date.timeIntervalSince1970)" }
    }

    func points(_ metric: String) -> [Point] {
        page.days.compactMap { day, m in
            guard let v = m[metric], let d = DayString.date(day) else { return nil }
            return Point(date: d, value: v)
        }
        .sorted { $0.date < $1.date }
    }

    var body: some View {
        let sleep = ["sleep_deep_min": "Deep", "sleep_core_min": "Core", "sleep_rem_min": "REM"].flatMap { key, name in points(key).map { Point(date: $0.date, value: $0.value / 60, series: name) } }
        let hrv = points("hrv_ms")
        let rhr = points("resting_hr")
        let steps = points("steps")
        let vo2 = points("vo2max")
        let balance = energyBalance

        VStack(spacing: 16) {
            if !sleep.isEmpty {
                ChartCard(title: "Sleep", symbol: "bed.double.fill", tint: Palette.sleep, headline: average(points("sleep_min")).map { Fmt.sleep($0) }, caption: "average") {
                    Chart(sleep) { p in
                        BarMark(x: .value("Day", p.date, unit: .day), y: .value("Hours", p.value))
                            .foregroundStyle(by: .value("Stage", p.series))
                    }
                    .chartForegroundStyleScale(["Deep": Color.indigo, "Core": Color.blue, "REM": Color.cyan])
                    .chartYAxis { AxisMarks(values: .automatic(desiredCount: 3)) }
                }
            }
            if !hrv.isEmpty {
                ChartCard(title: "Heart rate variability", symbol: "waveform.path.ecg", tint: .pink, headline: average(hrv).map { "\(Fmt.number($0)) ms" }, caption: "average") {
                    BaselineChart(points: hrv, color: .pink)
                }
            }
            if !rhr.isEmpty {
                ChartCard(title: "Resting heart rate", symbol: "heart.fill", tint: .red, headline: average(rhr).map { "\(Fmt.number($0)) bpm" }, caption: "average") {
                    BaselineChart(points: rhr, color: .red)
                }
            }
            if !vo2.isEmpty {
                ChartCard(title: "Cardio fitness", symbol: "lungs.fill", tint: .green, headline: vo2.last.map { String(format: "%.1f", $0.value) }, caption: "VO2 max") {
                    Chart(vo2) { LineMark(x: .value("Day", $0.date, unit: .day), y: .value("VO2 max", $0.value)).foregroundStyle(Color.green).interpolationMethod(.catmullRom) }
                        .chartYScale(domain: .automatic(includesZero: false))
                }
            }
            if !steps.isEmpty {
                ChartCard(title: "Steps", symbol: "figure.walk", tint: .orange, headline: average(steps).map { Fmt.number($0) }, caption: "a day") {
                    Chart(steps) { BarMark(x: .value("Day", $0.date, unit: .day), y: .value("Steps", $0.value)).foregroundStyle(Color.orange.gradient) }
                        .chartYAxis { AxisMarks(values: .automatic(desiredCount: 3)) }
                }
            }
            if !balance.isEmpty {
                ChartCard(title: "Energy balance", symbol: "scale.3d", tint: .teal, headline: average(balance).map { "\($0 >= 0 ? "+" : "")\(Fmt.number($0)) kcal" }, caption: "a day, food minus burned") {
                    Chart(balance) { p in
                        BarMark(x: .value("Day", p.date, unit: .day), y: .value("kcal", p.value))
                            .foregroundStyle(p.value >= 0 ? Color.green : Color.orange)
                    }
                    .chartYAxis { AxisMarks(values: .automatic(desiredCount: 3)) }
                }
            }
            if checkins.count > 1 {
                let w = checkins.compactMap { c in DayString.date(c.date).map { Point(date: $0, value: c.weightKg) } }
                ChartCard(title: "Bodyweight", symbol: "scalemass.fill", tint: .teal, headline: checkins.first.map { Fmt.kg($0.weightKg) }, caption: "latest") {
                    Chart(w) {
                        LineMark(x: .value("Day", $0.date, unit: .day), y: .value("kg", $0.value)).foregroundStyle(Color.teal).interpolationMethod(.catmullRom)
                        PointMark(x: .value("Day", $0.date, unit: .day), y: .value("kg", $0.value)).foregroundStyle(Color.teal).symbolSize(20)
                    }
                    .chartYScale(domain: .automatic(includesZero: false))
                }
            }
            if !runs.isEmpty {
                let pace = runs.compactMap { r -> Point? in
                    guard let km = r.distanceKm, km > 0, let min = r.durationMin, let d = DayString.date(r.date) else { return nil }
                    return Point(date: d, value: min * 60 / km / 60)
                }
                ChartCard(title: "Run pace", symbol: "figure.run", tint: .blue, headline: average(pace).map { Fmt.paceFrom(secPerKm: $0 * 60) }, caption: "average") {
                    Chart(pace) { PointMark(x: .value("Day", $0.date, unit: .day), y: .value("min/km", $0.value)).foregroundStyle(Color.blue) }
                        .chartYScale(domain: .automatic(includesZero: false, reversed: true))
                }
            }
            if sleep.isEmpty, hrv.isEmpty, steps.isEmpty, checkins.count < 2 {
                ContentUnavailableView("No trends yet", systemImage: "chart.xyaxis.line", description: Text("Connect Apple Health in More, and data shows up after the first sync."))
            }
        }
    }

    var energyBalance: [Point] {
        let food = Dictionary(uniqueKeysWithValues: (page.food ?? []).map { ($0.date, $0.kcal) })
        return page.days.compactMap { day, m in
            guard let a = m["active_kcal"], let b = m["basal_kcal"], let f = food[day], let d = DayString.date(day), day < DayString.today() else { return nil }
            return Point(date: d, value: f - a - b)
        }
        .sorted { $0.date < $1.date }
    }

    func average(_ p: [Point]) -> Double? { p.isEmpty ? nil : p.map(\.value).reduce(0, +) / Double(p.count) }
}

/// A line against the range's own average band, so "below usual" is visible at a glance.
struct BaselineChart: View {
    var points: [TrendCharts.Point]
    var color: Color
    @State private var selected: Date?

    var body: some View {
        let values = points.map(\.value)
        let mean = values.reduce(0, +) / Double(max(values.count, 1))
        let sd = sqrt(values.map { ($0 - mean) * ($0 - mean) }.reduce(0, +) / Double(max(values.count, 1)))
        Chart {
            RectangleMark(yStart: .value("Low", mean - sd), yEnd: .value("High", mean + sd))
                .foregroundStyle(color.opacity(0.1))
            ForEach(points) { p in
                LineMark(x: .value("Day", p.date, unit: .day), y: .value("Value", p.value))
                    .foregroundStyle(color)
                    .interpolationMethod(.catmullRom)
            }
            if let selected, let p = points.min(by: { abs($0.date.timeIntervalSince(selected)) < abs($1.date.timeIntervalSince(selected)) }) {
                RuleMark(x: .value("Day", p.date, unit: .day))
                    .foregroundStyle(.secondary.opacity(0.4))
                    .annotation(position: .top, overflowResolution: .init(x: .fit, y: .disabled)) {
                        Text("\(Fmt.number(p.value)) · \(p.date.formatted(.dateTime.day().month()))").font(.caption.weight(.semibold)).padding(4)
                            .background(.regularMaterial, in: .rect(cornerRadius: 6))
                    }
            }
        }
        .chartYScale(domain: .automatic(includesZero: false))
        .chartXSelection(value: $selected)
        .chartYAxis { AxisMarks(values: .automatic(desiredCount: 3)) }
    }
}

struct ChartCard<C: View>: View {
    var title: String
    var symbol: String
    var tint: Color
    var headline: String?
    var caption: String
    @ViewBuilder var chart: C

    var body: some View {
        Card(title: title, symbol: symbol, tint: tint) {
            if let headline {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(headline).font(.title2.weight(.semibold)).numeric()
                    Text(caption).font(.subheadline).foregroundStyle(.secondary)
                }
            }
            chart.frame(height: 160)
        }
    }
}
