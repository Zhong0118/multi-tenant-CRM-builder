import type { ImportAssistRequest, ImportAssistPlan, ImportPreviewColumn } from "@crm/contracts";
import { selectOptions, type PublishedFieldView } from "@/features/objects/object-types";
import { normalizeHeader, matchImportOption, inferImportDateOrder, splitImportOptions } from "./record-csv";
import type { ImportFile } from "./record-import-file";
import { initialMapping, ownerHeader, SKIP, OWNER, APPEND } from "./record-import-mapping";

export const importableField = (f: PublishedFieldView) => !f.isSystem && f.type !== "MEMBER" && (f.access === "EDIT" || f.access === "CREATE_ONLY");
export type AssistDraft = {
  mapping: string[]; manual: number[]; matchFields: string[];
  dateOrders: Record<number, "DMY" | "MDY">;
  amountUnits: Record<number, "yuan" | "wan">;
  valueChoices: Record<number, ReadonlyMap<string,string|null>>;
};
export function emptyAssistDraft(headers: string[], fields: PublishedFieldView[], admin: boolean): AssistDraft {
  return {mapping:initialMapping(headers,fields.filter(importableField),admin),manual:[],matchFields:[],dateOrders:{},amountUnits:{},valueChoices:{}};
}

// Unknown text (including plausible personal names and workbook titles) stays local.
const labelWords = /(?:客户|单位|企业|公司|联系|意向|业务|成交|预计|合同|订单|销售|线索|来源|跟进|联系|创建|签约|项目|渠道|客户名|全称|简称|名称|电话|手机|号码|编号|编码|代码|评级|级别|等级|分级|分类|类型|状态|阶段|日期|时间|金额|预算|单价|数额|万元|万|元|地区|省份|城市|行业|标签|备注|描述|评价|地址|邮箱|邮件|网址|是否|有效|启用|重点|优先级|company|account|customer|contact|business|client|full|name|phone|mobile|email|id|code|amount|budget|date|time|stage|status|level|tier|grade|tag|type|source|channel|notes?|remark|value|region|industry|priority|rmb|cny|[()（）_ /-])/iy;
function businessLabel(s:string){
  labelWords.lastIndex=0;
  while(labelWords.lastIndex<s.length)if(!labelWords.test(s))return false;
  return s.length>0;
}
const enumLabel = /^(?:[A-FＳS](?:类|级|档|等)?|(?:重点|普通|潜在|意向|成交|老|新)(?:客户)?|未评级|高|中|低|展会|转介|转介绍|线上|线下|广告|网站|其他|未知|待联系|已联系|进行中|已完成|是|否|true|false|yes|no)$/i;
const clip = (s:string)=>Array.from(s).slice(0,40).join("");
function safeLabel(s:string,fields:PublishedFieldView[]) {
  const key=normalizeHeader(s);
  const field=fields.find(f=>[f.fieldKey,f.label].some(v=>normalizeHeader(v)===key));
  return field ? clip(field.label) : s.length<=80 && businessLabel(s.trim()) ? clip(s.trim()) : "";
}
function safeValue(raw:string):string|undefined {
  const v=raw.trim().normalize("NFKC");
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(v)) return "[邮箱]";
  if (/\d(?:[\s()+.\-]*\d){6,}/u.test(v) && !/^\d{4}[-/]\d\d?[-/]\d\d?$/.test(v)) return "[号码]";
  if (/^(?:[+-]?[¥￥]?\d{1,6}(?:[,.]\d{1,6})*(?:[万亿]?元?)?|\d{1,4}[-/]\d{1,2}[-/]\d{2,4})$/.test(v) || enumLabel.test(v)) return clip(v);
}
export function importValueCounts(rows:string[][],index:number,field?:PublishedFieldView) {
  const counts=new Map<string,number>();
  for(const row of rows){
    const raw=(row[index]??"").trim();
    const parts=field?.type==="MULTI_SELECT"?splitImportOptions(raw):[raw];
    for(const part of new Set(parts)) if(part) counts.set(part,(counts.get(part)??0)+1);
  }
  return counts;
}
export const isOptionField=(field?:PublishedFieldView)=>field?.type==="SINGLE_SELECT"||field?.type==="MULTI_SELECT";
export const activeOptions=(field?:PublishedFieldView)=>field?selectOptions(field).filter(o=>o.status==="ACTIVE"):[];
type PreviewInput={file:ImportFile;sheet:string;headerRow:number;headerLocked:boolean;fields:PublishedFieldView[];draft:AssistDraft;excluded?:number[];admin?:boolean};
export function buildImportPreview({file,sheet,headerRow,headerLocked,fields,draft,excluded=[],admin=false}:PreviewInput) {
  const allowed=fields.filter(importableField), blocked=new Set(excluded);
  const denied=new Set(fields.filter(f=>!importableField(f)).flatMap(f=>[normalizeHeader(f.label),normalizeHeader(f.fieldKey)]));
  const leading=file.headerSelection(sheet,allowed).candidates;
  for(const row of leading) row.cells.forEach((s,i)=>{if(ownerHeader(s)||/owner|assignee|salesrep|salesperson|经办人|跟单人/i.test(normalizeHeader(s))||denied.has(normalizeHeader(s))) blocked.add(i)});
  draft.mapping.forEach((key,i)=>{if(key===OWNER) blocked.add(i)});
  const request:ImportAssistRequest={sheet:safeLabel(sheet,allowed)||"工作表",currentHeader:headerRow,headerLocked,candidates:[]};
  const bindings=new Map<string,string>();
  const ambiguousDates=new Set<string>();
  let unresolvedColumns=0,unresolvedValues=0;
  for(const candidate of leading){
    const current=candidate.rowNumber===headerRow;
    if(!current && (headerLocked || !candidate.cells.some(s=>safeLabel(s,allowed))))continue;
    let parsed;
    try {parsed=file.sheet(sheet,candidate.rowNumber)} catch {
      if(current)request.candidates.push({headerRow,columns:candidate.cells.map((_,i)=>({col:"C"+(i+1),header:"",samples:[],excluded:true}))});
      continue;
    }
    const base=current?draft:emptyAssistDraft(parsed.headers,fields,admin);
    const columns=parsed.headers.map((raw,i):ImportPreviewColumn=>{
      const col="C"+(i+1), key=base.mapping[i];
      const c:ImportPreviewColumn={col,header:"",samples:[]};
      if(blocked.has(i)) return {...c,excluded:true};
      if(!current && (draft.manual.includes(i) || (draft.mapping[i] && draft.mapping[i]!==SKIP)))return {...c,excluded:true};
      const field=allowed.find(f=>f.fieldKey===key);
      if(field)c.locked={mode:"field",field:key};
      else if(key.startsWith(APPEND))c.locked={mode:"append",field:key.slice(APPEND.length)};
      else if(base.manual.includes(i))c.locked={mode:"skip"};
      const header=safeLabel(raw,allowed);
      c.header=header;
      const isEnum=isOptionField(field);
      const isDate=field?.type==="DATE"||field?.type==="DATETIME";
      if(!header || (c.locked && !isEnum && !isDate))return c;
      if(isDate && (base.dateOrders[i] || inferImportDateOrder(parsed.rows.map(r=>r[i]))!=="ambiguous"))return c;
      if(isDate)ambiguousDates.add(candidate.rowNumber+":"+col);
      const counts=importValueCounts(parsed.rows,i,field);
      const options=activeOptions(field),samples=new Set<string>();
      const values:NonNullable<ImportPreviewColumn["values"]>=[];
      for(const [raw,count] of counts){
        if(isEnum && (matchImportOption(raw,options)!==undefined || base.valueChoices[i]?.has(raw)))continue;
        if(current && isEnum)unresolvedValues++;
        const safe=safeValue(raw);
        if(!safe)continue;
        if(!c.locked || isDate)if(samples.size<5)samples.add(safe);
        if(counts.size<=50 && !isDate){
          const id="V"+(values.length+1);
          values.push({id,text:safe,count});bindings.set(candidate.rowNumber+":"+col+":"+id,raw);
        }
      }
      c.samples=[...samples]; if(values.length)c.values=values;
      return c;
    });
    if(current)unresolvedColumns=base.mapping.filter((k,i)=>k===SKIP&&!base.manual.includes(i)&&!blocked.has(i)).length;
    request.candidates.push({headerRow:candidate.rowNumber,columns});
  }
  const all=request.candidates.flatMap(c=>c.columns);
  const bytes=()=>new TextEncoder().encode(JSON.stringify(request)).length;
  let remaining=bytes();
  let partial=false;
  if(remaining>80*1024){
    partial=true;
    for(let n=4;n>=0 && remaining>80*1024;n--){for(const c of all)c.samples=c.samples.slice(0,n);remaining=bytes()}
    for(const c of [...all].reverse()){
      if(remaining<=80*1024)break;
      if(c.values){remaining-=new TextEncoder().encode(JSON.stringify(c.values)).length;delete c.values}
    }
  }
  const needed=all.some(c=>!c.excluded && c.header && (!c.locked || c.values?.length || (c.samples.length && c.locked.mode==="field"))) || (!headerLocked && request.candidates.length>1);
  return {request,bindings,ambiguousDates,needed,partial,unresolvedColumns,unresolvedValues};
}
export type ImportPreview=ReturnType<typeof buildImportPreview>;
export type AdoptChoice={column:string;value?:string};
export function applyImportAdvice(draft:AssistDraft,preview:ImportPreview,plan:ImportAssistPlan,fields:PublishedFieldView[],adopt?:AdoptChoice,queryKeys?:string[]):AssistDraft {
  const candidate=preview.request.candidates.find(c=>c.headerRow===plan.headerRow);
  if(!candidate)return draft;
  const next:AssistDraft={...draft,mapping:[...draft.mapping],dateOrders:{...draft.dateOrders},amountUnits:{...draft.amountUnits},valueChoices:{...draft.valueChoices}};
  const allowed=fields.filter(importableField);
  for(const a of plan.columns){
    const i=candidate.columns.findIndex(c=>c.col===a.col), source=candidate.columns[i];
    if(!source||source.excluded||!source.header|| (adopt && adopt.column!==a.col))continue;
    const {target}=a;
    if(target.mode==="skip")continue;
    const field=allowed.find(f=>f.fieldKey===target.field);
    if(!field || (target.mode==="append"&&field.type!=="TEXTAREA"))continue;
    const key=(target.mode==="append"?APPEND:"")+target.field;
    if(source.locked && (source.locked.mode!==target.mode||source.locked.field!==target.field))continue;
    if(target.mode==="field" && (next.mapping.some((k,j)=>j!==i && k===key) || plan.columns.some(b=>b.col!==a.col && b.target.mode==="field" && b.target.field===key && !source.locked))) continue;
    if(next.mapping[i]!==key){
      if(next.mapping[i]!==SKIP || draft.manual.includes(i) || (a.confidence!=="high" && (!adopt || adopt.value)))continue;
      next.mapping[i]=key;
    }
    if(a.confidence==="high" || (adopt && !adopt.value)){
      if(a.dateOrder && (field.type==="DATE"||field.type==="DATETIME") && (!source.locked||preview.ambiguousDates.has(plan.headerRow+":"+a.col)))next.dateOrders[i]??=a.dateOrder;
      if(a.bareAmountUnit && (field.type==="MONEY"||field.type==="NUMBER") && !source.locked)next.amountUnits[i]??=a.bareAmountUnit;
    }
    if(!isOptionField(field))continue;
    const choices=new Map(next.valueChoices[i]);
    for(const v of a.values??[]){
      if(v.confidence!=="high" && adopt?.value!==v.value)continue;
      if(!source.values?.some(item=>item.id===v.value))continue;
      const raw=preview.bindings.get(plan.headerRow+":"+a.col+":"+v.value);
      if(raw!==undefined && !choices.has(raw) && (v.option===null||activeOptions(field).some(o=>o.key===v.option)))choices.set(raw,v.option);
    }
    next.valueChoices[i]=choices;
  }
  next.matchFields=[...new Set([...draft.matchFields,...plan.matchFields.filter(k=>next.mapping.includes(k)&&allowed.some(f=>f.fieldKey===k&&f.type!=="MULTI_SELECT")&&(!queryKeys||queryKeys.includes(k)))])].slice(0,3);
  return next;
}
