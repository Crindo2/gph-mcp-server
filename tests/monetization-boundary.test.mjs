import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { callTool, serveTool, buildTelemetry } from '../functions/mcp.js';
import { quotesLink } from '../functions/_shared/monetization-boundary.js';
const cases = JSON.parse(readFileSync(new URL('./fixtures/row16-baseline.json', import.meta.url)));
const row = cases[0].data.matches[0];
const enabled = { MCP_GET_QUOTES_ENABLED: '1', MCP_GET_QUOTES_URL: 'https://row16-fixture.pages.dev/get-quotes/' };
async function upstream(data, run) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ok: true, status: 200, json: async () => structuredClone(data)});
  try { return await run(); } finally { globalThis.fetch = real; }
}
for (const [i, c] of cases.entries()) {
  test(`default-off byte identity with pre-change response ${i}: ${c.name}`, async () => {
    await upstream(c.data, async () => {
      for (const env of [undefined, {}, {...enabled, MCP_GET_QUOTES_ENABLED: '0'}, {...enabled, MCP_GET_QUOTES_ENABLED: 'true'}]) {
        assert.equal(JSON.stringify(await callTool(c.name, c.args, {env})), c.expected);
        assert.equal(JSON.stringify((await serveTool(c.name, c.args, {env})).result), c.expected);
      }
    });
  });
}
for (const marker of [{sponsored:true}, {sponsored:1}, {sponsored:'1'}, {is_sponsored:true}, {is_sponsored:1}, {is_sponsored:'1'}, {entry_type:'sponsored'}, {placement_type:'sponsored'}]) {
  test(`sponsored exclusion on every organic path: ${JSON.stringify(marker)}`, async () => {
    const paid = {...row, ...marker, slug:'paid-fixture', company_name:'PAID_SENTINEL'};
    const rows = [paid, ...Array.from({length:6}, (_, i) => ({...row,slug:`organic-${i}`}))];
    for (const cached of [false, true]) {
      const data = {success:true,total:7,matches:rows,providers:rows,pagination:{total:7}};
      const cache = { match: async () => new Response(JSON.stringify(data), {headers:{'x-gph-cached-at':'1000'}}), put: async () => {} };
      await upstream(data, async () => {
        for (const name of ['match_practice','search_providers']) {
          const {result} = await serveTool(name, {}, {now:1001,env:cached?{__SEARCH_CACHE_FOR_TESTS:cache}:null});
          assert.doesNotMatch(JSON.stringify(result), /PAID_SENTINEL|paid-fixture/);
          assert.equal(result.count,6);
          assert.equal(result.ids.surfaced[0],'organic-0');
          assert.equal(result.ids.surfaced.length,name==='match_practice'?5:6);
        }
      });
    }
    await upstream({success:true,provider:paid}, async () => {
      const result = await callTool('get_provider_detail',{slug:paid.slug});
      assert.equal(result.count,0); assert.equal(result.isError,true); assert.equal(result.ids,undefined);
      assert.doesNotMatch(JSON.stringify(result), /PAID_SENTINEL/);
    });
  });
}
test('all-sponsored results expose zero organic count and no surfaced IDs', async () => {
  await upstream({success:true,total:5,matches:[{...row,sponsored:true}],providers:[{...row,sponsored:true}]}, async () => {
    for (const name of ['match_practice','search_providers']) {
      const result = await callTool(name,{}); assert.equal(result.count,0); assert.deepEqual(result.ids.surfaced,[]);
    }
  });
});
test('sponsorship membership never removes an independently organic vendor', async () => {
  await upstream({success:true,total:1,matches:[{...row,plan:'sponsor',sponsorship_active:true}],sponsored:[{...row,sponsored:true}]}, async () => {
    const result = await callTool('match_practice',{}); assert.equal(result.count,1); assert.deepEqual(result.ids.surfaced,[row.slug]);
  });
});
test('Quotes is present only for explicit deliverable contact and enabled staging config', async () => {
  for (const source of ['claimed_profile','verified_sales']) {
    for (const deliverable of [true,false,undefined,1,'true']) {
      await upstream({success:true,matches:[{...row,quotes_contact_source:source,quotes_contact_deliverable:deliverable}]}, async () => {
        const {result} = await serveTool('match_practice',{}, {env:enabled});
        const text=result.content[0].text;
        if (deliverable===true) {
          assert.match(text,/Get Quotes: https:\/\/row16-fixture.pages.dev\/get-quotes\/\?vendor=fixture-organic&source=mcp/);
          assert.match(text,/Website: https:\/\/vendor.invalid/);
        } else assert.doesNotMatch(text,/Get Quotes:/);
      });
    }
  }
  for (const patch of [{quotes_contact_source:undefined},{quotes_contact_source:'published'}, {slug:'unsafe?token=x'}, {quotes_contact_deliverable:false,claimed:1,verified:1}]) {
    assert.equal(quotesLink({...row,...patch},enabled),'');
  }
  for (const url of [undefined,'https://www.getpracticehelp.com/get-quotes/','http://fixture.pages.dev/','https://fixture.pages.dev/?secret=x','https://fixture.pages.dev/#x','https://user:pass@fixture.pages.dev/','https://fixture.pages.dev.evil.invalid/']) {
    assert.equal(quotesLink(row,{...enabled,MCP_GET_QUOTES_URL:url}),'');
  }
});
test('no private inquiry fields survive any tool response, including raw EHR JSON', async () => {
  const secret = 'PRIVATE_INQUIRY_SENTINEL';
  const privateFields = {_private:{email:secret},inquiry:{note:secret},inquiries:[{work_email:secret}],work_email:secret,consent_token:secret,withdrawal_token:secret,practice_details:secret,contact_email:secret};
  for (const c of cases) {
    const data=structuredClone(c.data);
    Object.assign(data,privateFields);
    if(data.matches) data.matches=data.matches.map(r=>({...r,...privateFields}));
    if(data.providers) data.providers=data.providers.map(r=>({...r,...privateFields}));
    if(data.provider) Object.assign(data.provider,privateFields);
    await upstream(data,async()=>assert.doesNotMatch(JSON.stringify(await callTool(c.name,c.args,{env:enabled})),/PRIVATE_INQUIRY_SENTINEL|work_email|withdrawal_token/));
  }
  await upstream({schema_version:'1.0.0',product:{product_key:'fixture',editions:[],...privateFields},...privateFields},async()=>{
    const result=await callTool('get_ehr_product_detail',{product_key:'fixture'});
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE_INQUIRY_SENTINEL|work_email|withdrawal_token/);
    assert.equal(JSON.parse(result.content[0].text).product.product_key,'fixture');
  });
});
test('C812 estate clients remain labelled internal in demand telemetry even with assistant Origin', async () => {
  for (const ua of ['openai-mcp/1.0.0 (Codex)','cbeg-row16-fixture','verify-fix-organic']) {
    const request=new Request('https://fixture.invalid/mcp',{headers:{'user-agent':ua,origin:'https://chatgpt.com'}});
    const rec=await buildTelemetry('gph',request,{},'match_practice',{},1,'anonymous',{surfaced:[row.slug]},null);
    assert.equal(rec.caller_class,'internal'); assert.notEqual(rec.caller_class,'organic_assistant');
  }
});

test('mixed shortlist suppresses upstream summaries that may include sponsored entries', async () => {
  await upstream({success:true,total:2,matches:[{...row,sponsored:true},row],geo_honesty_note:'PAID_SUMMARY',needs_summary:{requested:1,evidenced_any:1,unknown:0}},async()=>{
    const text=(await callTool('match_practice',{})).content[0].text;
    assert.doesNotMatch(text,/PAID_SUMMARY|Service-need coverage/);
    assert.match(text,/Fixture Organic/);
  });
});
