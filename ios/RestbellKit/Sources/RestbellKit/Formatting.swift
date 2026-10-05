import Foundation

/// Short, consistent number formatting shared by the app, widgets and Live Activity.
public enum Fmt {
    public static func kg(_ w: Double?) -> String {
        guard let w else { return "—" }
        return w.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(w)) kg" : String(format: "%.1f kg", w)
    }

    public static func number(_ n: Double?) -> String {
        guard let n else { return "—" }
        return n.formatted(.number.precision(.fractionLength(0)))
    }

    /// "8 × 60 kg", "3 × 30 s", "12 reps" for bodyweight.
    public static func target(_ ex: Exercise, weight: Double? = nil) -> String {
        let reps: String
        if ex.isTimed {
            reps = "\(ex.repMax ?? 30) s"
        } else if let lo = ex.repMin, let hi = ex.repMax, lo != hi {
            reps = "\(lo)–\(hi)"
        } else {
            reps = "\(ex.targetReps)"
        }
        let w = weight ?? ex.weight
        if let w, w > 0 { return "\(reps) × \(kg(w))" }
        return ex.isTimed ? reps : "\(reps) reps"
    }

    /// 5:07/km
    public static func pace(minutes: Double?, km: Double?) -> String? {
        guard let minutes, let km, km > 0, minutes > 0 else { return nil }
        return paceFrom(secPerKm: minutes * 60 / km)
    }

    public static func paceFrom(secPerKm: Double) -> String {
        let s = Int(secPerKm.rounded())
        return "\(s / 60):\(String(format: "%02d", s % 60))/km"
    }

    /// 1:05:30 or 25:30
    public static func clock(_ seconds: Double) -> String {
        let s = max(0, Int(seconds.rounded()))
        return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60) : String(format: "%d:%02d", s / 60, s % 60)
    }

    /// 7 h 40
    public static func sleep(_ minutes: Double?) -> String {
        guard let minutes else { return "—" }
        let m = Int(minutes.rounded())
        return "\(m / 60) h \(String(format: "%02d", m % 60))"
    }

    public static func duration(_ minutes: Double?) -> String {
        guard let minutes else { return "—" }
        let m = Int(minutes.rounded())
        return m >= 60 ? "\(m / 60) h \(m % 60) min" : "\(m) min"
    }

    /// Mon 5 Oct
    public static func day(_ day: String, style: Date.FormatStyle = .dateTime.weekday(.abbreviated).day().month(.abbreviated)) -> String {
        DayString.date(day).map { $0.formatted(style) } ?? day
    }
}
