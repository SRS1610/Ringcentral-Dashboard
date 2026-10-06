const KEY = 'rc_dashboard_department_map'

export type DepartmentMap = Record<string, string>

export function loadDepartmentMap(): DepartmentMap {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function saveDepartmentMap(map: DepartmentMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    // ignore — mapping just won't persist across sessions
  }
}

export const UNASSIGNED_DEPARTMENT = 'Unassigned'

/**
 * The mapping saved in Settings wins; otherwise the department set on the extension in
 * RingCentral's own directory (`directoryDepartment`) is used.
 */
export function departmentFor(map: DepartmentMap, extensionNumber: string, directoryDepartment = ''): string {
  return map[extensionNumber]?.trim() || directoryDepartment.trim() || UNASSIGNED_DEPARTMENT
}
