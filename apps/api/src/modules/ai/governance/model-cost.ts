import { Prisma } from '@crm/database';
import type { Tx } from './admin-usage';

type Price = {
  currency: string | null;
  inputPrice: string | null;
  outputPrice: string | null;
};
export function estimatePlanCost(
  quota: string,
  price: Price | undefined,
  usage: { input: string; output: string },
) {
  if (
    !price ||
    !price.currency ||
    price.inputPrice === null ||
    price.outputPrice === null
  )
    return null;
  const units = new Prisma.Decimal(quota).div(1_000_000);
  const input = units.mul(price.inputPrice),
    output = units.mul(price.outputPrice);
  const tokens = new Prisma.Decimal(usage.input).add(usage.output);
  if (tokens.isZero())
    return {
      currency: price.currency,
      low: Prisma.Decimal.min(input, output).toString(),
      high: Prisma.Decimal.max(input, output).toString(),
      weighted: false,
    };
  const cost = input
    .mul(usage.input)
    .add(output.mul(usage.output))
    .div(tokens)
    .toString();
  return { currency: price.currency, low: cost, high: cost, weighted: true };
}

export async function platformTextModel(tx: Tx) {
  const [row] = await tx.$queryRaw<
    (Price & { provider: string; model: string })[]
  >`
    SELECT p.name AS provider, m.name AS model, m.currency, m.input_price::text AS "inputPrice",m.output_price::text AS "outputPrice"
    FROM ai_model_assignments a JOIN ai_model_providers p ON a.provider_id=p.id
    JOIN ai_config_models m ON (m.revision_id,m.name)=(a.revision_id,a.model_name)
    WHERE a.purpose='text' AND p.enabled`;
  return row;
}
export function planUsageMix(tx: Tx) {
  return tx.$queryRaw<{ id: string; input: string; output: string }[]>`
    SELECT c.plan_id AS id,sum(m.input_tokens)::text AS input,sum(m.output_tokens)::text AS output
    FROM tenant_ai_configs c JOIN ai_tenant_months m USING(tenant_id)
    WHERE c.plan_id IS NOT NULL GROUP BY c.plan_id`;
}
export function monthlyCosts(tx: Tx, id: string, month: string) {
  return tx.$queryRaw<
    {
      currency: string | null;
      cost: string;
      unpricedTokens: string;
      pricedTokens: string;
    }[]
  >`
    SELECT currency, coalesce(known_cost,0)::text AS cost,
       (input_tokens+output_tokens-priced_input_tokens-priced_output_tokens)::text AS "unpricedTokens",
       (priced_input_tokens+priced_output_tokens)::text AS "pricedTokens"
    FROM ai_company_model_costs(${id}::uuid,${month}::date) ORDER BY currency NULLS LAST`;
}
