import Foundation

/// "YYYY-MM-DD" day strings in the phone's time zone, like the PWA's localToday().
public enum DayString {
    static func formatter(_ tz: TimeZone) -> DateFormatter {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = tz
        f.dateFormat = "yyyy-MM-dd"
        return f
    }

    public static func of(_ date: Date, in tz: TimeZone = .current) -> String { formatter(tz).string(from: date) }
    public static func today(in tz: TimeZone = .current) -> String { of(Date(), in: tz) }

    /// Midday of the day, which is safe against DST jumps when adding days.
    public static func date(_ day: String, in tz: TimeZone = .current) -> Date? {
        formatter(tz).date(from: day).map { $0.addingTimeInterval(12 * 3600) }
    }

    public static func adding(_ days: Int, to day: String, in tz: TimeZone = .current) -> String {
        guard let d = date(day, in: tz) else { return day }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = tz
        return of(cal.date(byAdding: .day, value: days, to: d)!, in: tz)
    }

    /// Start of the day (local midnight).
    public static func start(of day: String, in tz: TimeZone = .current) -> Date? {
        formatter(tz).date(from: day)
    }
}

public enum ISOTime {
    static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    static let plain = ISO8601DateFormatter()

    public static func parse(_ s: String?) -> Date? {
        guard let s else { return nil }
        return fractional.date(from: s) ?? plain.date(from: s)
    }
    public static func string(_ d: Date) -> String { fractional.string(from: d) }
}
