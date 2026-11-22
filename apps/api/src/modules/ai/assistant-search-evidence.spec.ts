import { AssistantSearchEvidence } from './assistant-search-evidence';

const target = (recordId: string) => ({ objectCode: 'customers', recordId });
const query = { objectCode: 'customers', filters: { stage: 'quoted' } };

describe('assistant batch search coverage', () => {
  it('reports the distinct matching targets and visible total across pages', () => {
    const evidence = new AssistantSearchEvidence();
    evidence.observe(
      'search_records',
      { ...query, page: 1 },
      { total: 4, items: [{ id: 'a' }] },
    );
    evidence.observe(
      'search_records',
      { ...query, page: 2 },
      { total: 4, items: [{ id: 'b' }] },
    );
    expect(evidence.coverage([target('a'), target('b'), target('a')])).toEqual({
      total: 4,
      targets: 2,
    });
    expect(evidence.coverage([target('missing')])).toBeUndefined();
  });
  it('does not infer coverage after the visible total changes or a different search contributes targets', () => {
    const evidence = new AssistantSearchEvidence();
    evidence.observe('search_records', query, {
      total: 2,
      items: [{ id: 'a' }],
    });
    evidence.observe('search_records', query, {
      total: 3,
      items: [{ id: 'b' }],
    });
    expect(evidence.coverage([target('b')])).toBeUndefined();
    evidence.observe(
      'search_records',
      { ...query, query: 'other' },
      { total: 1, items: [{ id: 'c' }] },
    );
    expect(evidence.coverage([target('a'), target('c')])).toBeUndefined();
  });
});
