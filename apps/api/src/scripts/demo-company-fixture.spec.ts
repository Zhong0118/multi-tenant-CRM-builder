import { buildDemoCompanyFixture } from './demo-company-fixture';

describe('demo company fixture', () => {
  it('builds ten company members and gives every employee data in all six tables', () => {
    const fixture = buildDemoCompanyFixture();
    const administrators = fixture.users.filter(
      ({ role }) => role === 'TENANT_ADMIN',
    );
    const employees = fixture.users.filter(({ role }) => role === 'EMPLOYEE');

    expect(administrators).toHaveLength(2);
    expect(employees).toHaveLength(8);
    expect(new Set(fixture.users.map(({ phone }) => phone)).size).toBe(10);
    expect(
      fixture.template.configuration.objects.map(({ code }) => code),
    ).toEqual([
      'leads',
      'customers',
      'opportunities',
      'activities',
      'contracts',
      'payments',
    ]);
    expect(fixture.records).toHaveLength(96);

    for (const employee of employees) {
      const owned = fixture.records.filter(
        ({ ownerEmployeeNo }) => ownerEmployeeNo === employee.employeeNo,
      );
      expect(owned).toHaveLength(12);
      expect(new Set(owned.map(({ objectCode }) => objectCode)).size).toBe(6);
    }
  });
});
