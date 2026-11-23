// The model may recommend a preset. Only the separate administrator selection
// is projected into object and field permissions.
export const TABLE_EMPLOYEE_PRESETS = [
  "CLOSED",
  "CREATE_OWN",
  "READ_ALL_UPDATE_OWN",
] as const;
export type TableEmployeePreset = (typeof TABLE_EMPLOYEE_PRESETS)[number];

export function tableEmployeePresetAccess(preset: TableEmployeePreset) {
  const enabled = preset === "CREATE_OWN" || preset === "READ_ALL_UPDATE_OWN";
  return {
    canCreate: preset === "CREATE_OWN",
    canRead: enabled,
    canUpdate: enabled,
    canDelete: false,
    canImport: false,
    canExport: false,
    readScope:
      preset === "READ_ALL_UPDATE_OWN" ? "ALL" : enabled ? "OWN" : "NONE",
    updateScope: enabled ? "OWN" : "NONE",
    fieldAccess: enabled ? "EDIT" : "HIDDEN",
  } as const;
}
