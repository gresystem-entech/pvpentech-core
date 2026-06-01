/**
 * @module date
 *
 * 시간 처리 정책 요약 (A~E):
 *   A. Wire format: F/E↔B/E↔DB 전 구간 UTC ISO 8601("...Z"). API 응답은 항상 toISOString().
 *   B. F/E 표시: dayjs(utc).tz(businessTz).format(...). 브라우저 TZ 사용 금지.
 *   C. 백엔드 비즈니스 경계: 정산/통계의 일·월 경계는 env.TIMEZONE 기준.
 *      이 모듈의 getZonedDayRange / getZonedMonthRange 를 단일 진입점으로 사용.
 *   D. 배치 잡: cron 패턴은 .env, tz: env.TIMEZONE 은 코드에 명시(영업시간 의존 잡만).
 *   E. 금지: setHours/getHours 등 로컬 TZ 의존 Date 메서드, new Date(y,m,d,...) 다인자 생성자,
 *           toLocaleString 류(백엔드), toString() 직렬화.
 *      허용: new Date(), toISOString(), getTime(), Date.now(), getUTCHours/setUTCHours 등 UTC 명시 변형.
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * IANA Time Zone(예: "Asia/Ho_Chi_Minh") 기준의 "오늘" UTC 인스턴트 구간을 반환한다.
 *
 * - start: tz 기준 자정(00:00:00)에 해당하는 UTC Date
 * - end:   tz 기준 다음 날 자정(00:00:00)에 해당하는 UTC Date (exclusive)
 *
 * DST 전환일에도 dayjs/timezone 플러그인이 IANA 규칙을 정확히 적용한다.
 *
 * @example
 * const { start, end } = getZonedDayRange('Asia/Ho_Chi_Minh');
 * // start: "2026-05-27T17:00:00.000Z" (베트남 2026-05-28 00:00 KST)
 */
export function getZonedDayRange(
  tz: string,
  now: Date = new Date()
): { start: Date; end: Date } {
  const zonedNow = dayjs(now).tz(tz);
  const start = zonedNow.startOf('day').utc().toDate();
  const end = zonedNow.startOf('day').add(1, 'day').utc().toDate();
  return { start, end };
}

/**
 * IANA Time Zone 기준 "이번 달" UTC 인스턴트 구간을 반환한다.
 *
 * - start: tz 기준 해당 월 1일 00:00:00의 UTC Date
 * - end:   tz 기준 다음 달 1일 00:00:00의 UTC Date (exclusive)
 *
 * @example
 * const { start, end } = getZonedMonthRange('Asia/Ho_Chi_Minh');
 * // start: "2026-04-30T17:00:00.000Z" (베트남 2026-05-01 00:00)
 */
export function getZonedMonthRange(
  tz: string,
  now: Date = new Date()
): { start: Date; end: Date } {
  const zonedNow = dayjs(now).tz(tz);
  const start = zonedNow.startOf('month').utc().toDate();
  const end = zonedNow.startOf('month').add(1, 'month').utc().toDate();
  return { start, end };
}

/**
 * IANA Time Zone 기준 날짜 라벨을 "YYYY-MM-DD" 형식으로 반환한다.
 *
 * @example
 * getZonedDayLabel('Asia/Ho_Chi_Minh', new Date('2026-05-28T10:00:00Z'))
 * // => "2026-05-28"
 */
export function getZonedDayLabel(tz: string, date: Date = new Date()): string {
  return dayjs(date).tz(tz).format('YYYY-MM-DD');
}

/**
 * IANA Time Zone 기준 월 라벨을 "YYYY-MM" 형식으로 반환한다.
 *
 * @example
 * getZonedMonthLabel('Asia/Ho_Chi_Minh', new Date('2026-05-28T10:00:00Z'))
 * // => "2026-05"
 */
export function getZonedMonthLabel(tz: string, date: Date = new Date()): string {
  return dayjs(date).tz(tz).format('YYYY-MM');
}
