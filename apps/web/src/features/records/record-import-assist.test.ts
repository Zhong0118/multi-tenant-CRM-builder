import { describe, it, expect } from "vitest";
import type { PublishedFieldView } from "@/features/objects/object-types";
import { buildImportRows, SKIP } from "./record-import-mapping";
import { readImportFile } from "./record-import-file";
import { buildImportPreview, emptyAssistDraft, applyImportAdvice } from "./record-import-assist";

const field = (fieldKey: string, label: string, type = "TEXT", access = "EDIT") =>
  ({ fieldKey, label, type, access, config: {options:[{key:"a",label:"A级"}]} }) as PublishedFieldView;
const fields = [field("name","名称"), field("tier","评级","MULTI_SELECT"), field("private","密薪","TEXT","READ_ONLY"), field("amount","金额","MONEY")];
async function preview(csv: string, excluded: number[] = []) {
  const file = await readImportFile(new File([csv],"test.csv"),"auto");
  const header = file.headerSelection("",fields);
  const parsed = file.sheet("",header.headerRow);
  const draft = emptyAssistDraft(parsed.headers,fields,false);
  return {parsed,draft,preview:buildImportPreview({file,sheet:"",headerRow:header.headerRow,headerLocked:true,fields,draft,excluded})};
}
describe("browser import assistance", () => {
  it("only sends unresolved value IDs, keeps locked/owner/restricted columns private, and counts the whole file",async()=>{
    const {preview:p} = await preview("名称,评级,密薪,业务员,单位名称\n"+Array(7).fill("秘密公司,A级；A类,SECRET,绝密人名,某某客户").join("\n"),[4]);
    expect(JSON.stringify(p.request)).not.toMatch(/秘密公司|A级|密薪|SECRET|绝密人名|某某客户|单位名称/);
    expect(p.request.candidates[0].columns[1]).toMatchObject({locked:{mode:"field",field:"tier"},samples:[],values:[{text:"A类",count:7}]});
  });
  it("uses the same draft and row conversion for confirmed null, unresolved options and explicit units",async()=>{
    const {parsed,draft,preview:p} = await preview("评级,预算万元\nA级；A类,2\n未知,3元");
    const value=p.request.candidates[0].columns[0].values![0].id;
    const plan={version:1 as const,generatedAt:"",headerRow:1,matchFields:[],columns:[
      {col:"C1",target:{mode:"field" as const,field:"tier"},confidence:"high" as const,reason:"",values:[{value,option:null,confidence:"review" as const}]},
      {col:"C2",target:{mode:"field" as const,field:"amount"},confidence:"review" as const,reason:"",bareAmountUnit:"wan" as const}]};
    const high=applyImportAdvice(draft,p,plan,fields);
    expect(high.mapping[1]).toBe(SKIP);
    const adopted=applyImportAdvice(high,p,plan,fields,{column:"C2"});
    const decided=applyImportAdvice(adopted,p,plan,fields,{column:"C1",value});
    const rows=buildImportRows({parsed,fields,...decided,destination:()=>({kind:"default"})});
    expect(rows[0]).toMatchObject({values:{tier:null,amount:"20000"}});
    expect(rows[1]).toMatchObject({values:{amount:"3"},error:{code:"RECORD_IMPORT_INVALID"}});
  });
});
