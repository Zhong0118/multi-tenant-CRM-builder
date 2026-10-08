import { describe, expect, it } from "vitest";
import { parseMemberImport } from "./member-import";

describe("member import preview", () => {
  it("reads pasted spreadsheet rows and normalizes phone identity", () => {
    const { rows } = parseMemberImport(
      "姓名\t手机号\t角色\r\n张三\t13800138000\t员工\r\n李四\t+8613900139000\t公司管理员",
    );
    expect(rows).toEqual([
      {
        line: 2,
        displayName: "张三",
        phone: "+8613800138000",
        role: "EMPLOYEE",
      },
      {
        line: 3,
        displayName: "李四",
        phone: "+8613900139000",
        role: "TENANT_ADMIN",
      },
    ]);
  });
  it("supports BOM and quoted CSV names without silently truncating extra columns", () => {
    expect(
      parseMemberImport('\uFEFF姓名,手机号,角色\n"张,三",13800138000,').rows[0],
    ).toMatchObject({ displayName: "张,三", role: "EMPLOYEE" });
    expect(() =>
      parseMemberImport("姓名,手机号\n张三,13800138000,unexpected"),
    ).toThrow();
  });
  it("identifies both occurrences of the same phone and invalid values before submission", () => {
    const { rows } = parseMemberImport(
      "姓名,手机号,角色\n张三,13800138000,员工\n李四,+8613800138000,员工\n,13900139000,管理员x\n赵六,123,员工",
    );
    expect(rows.every((row) => Boolean(row.error))).toBe(true);
    expect(rows[0].error).toMatch(/重复/);
    expect(rows[1].error).toMatch(/重复/);
  });
  it("rejects an empty, oversized or malformed roster", () => {
    expect(() => parseMemberImport("姓名,手机号\n")).toThrow();
    expect(() => parseMemberImport('姓名,手机号\n"张三,13800138000')).toThrow();
    expect(() =>
      parseMemberImport(
        "姓名,手机号\n" +
          Array.from({ length: 101 }, () => "张三,13800138000").join("\n"),
      ),
    ).toThrow();
    expect(() => parseMemberImport("姓名,密码\n张三,secret")).toThrow();
  });
});
