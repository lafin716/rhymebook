type ClassValue = string | false | null | undefined | 0;

/** 조건부 className 결합 */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ');
}
