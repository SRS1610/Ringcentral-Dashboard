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

export function departmentFor(map: DepartmentMap, extensionNumber: string): string {
  return map[extensionNumber]?.trim() || 'Unassigned'
}
