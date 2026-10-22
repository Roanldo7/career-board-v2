// Every value in this generator is synthetic. Never load a personal database here.
export function syntheticData() {
  const stamp = '2026-10-07T00:00:00.000Z';
  const employers = Array.from({length: 40}, (_, i) => ({
    id: `SYN-E${String(i + 1).padStart(2, '0')}`,
    canonical_name: i === 1 ? '合成样例银行' : `合成企业${String(i + 1).padStart(2, '0')}`,
    aliases: i === 2 ? ['合成别名银行'] : [],
    identity_status: 'confirmed',
  }));
  const jobs = employers.map((e, i) => ({
    id: `SYN-J${String(i + 1).padStart(2, '0')}`, employer_id: e.id,
    company_name: e.canonical_name, job_title: `合成数据分析岗位${String(i + 1).padStart(2, '0')}`,
    location_text: i < 36 ? '杭州' : ['南京', '天津', '上海', '南京'][i - 36],
    city_group: i < 36 ? '杭州' : ['南京', '滨海新区', '其他强推', '南京'][i - 36],
    priority: i < 4 ? 'S' : 'A', resume_family: 'B', recruitment_type: '2027届正式校园招聘',
    recruitment_batch: '2027正式批', apply_url: `${i===0?'www.example.com':'https://example.com'}/campus/${i + 1}?keep=synthetic%2Btoken`,
    source_url: 'https://example.com/synthetic-source', notes: `合成备注${i + 1}；本数据仅用于隔离测试`,
    salary_confidence: 'Unknown', ...(i === 0 ? {monthly_low: 12000, salary_text: '合成月薪12000'} : {}),
    updated_at: stamp, canonical_opportunity_id: `SYN-O${i + 1}`,
    ...(i === 0 ? {eligible_city_groups: ['杭州', '南京']} : {}),
    ...(i === 3 ? {consideration_status: 'deferred'} : {}),
  }));
  jobs.push({...jobs[0], id: 'SYN-J01-SIBLING', job_title: '合成产品经理兄弟岗位', canonical_opportunity_id: 'SYN-O1-SIBLING', eligible_city_groups: ['杭州'], salary_text: undefined});
  const applications = Array.from({length: 14}, (_, i) => ({
    id: `SYN-A${String(i + 1).padStart(2, '0')}`, employer_id: employers[i].id,
    company_name: employers[i].canonical_name, job_title: jobs[i].job_title,
    status: i === 0 ? '待一面' : '已投递', applied_date: `2026-09-${String(i + 1).padStart(2, '0')}`,
    city: jobs[i].location_text, apply_url: jobs[i].apply_url,
    source_job_id: jobs[i].id, canonical_opportunity_id: jobs[i].canonical_opportunity_id,
    recruitment_batch: jobs[i].recruitment_batch,
    opportunity_refs: [{kind: 'job', record_id: jobs[i].id, employer_id: employers[i].id, canonical_opportunity_id: jobs[i].canonical_opportunity_id}],
    notes: `合成申请备注${i + 1}`, next_action: '待测评',
    created_at: stamp, updated_at: stamp,
    status_history: i === 0 ? [{from: '已投递', to: '待一面', at: stamp}] : [],
  }));
  return {
    version: 2, revision: 4, employers, jobs, leads: [], applications, tombstones: [], saved_views: [], command_receipts: [],
    settings: {binhai_salary_ratio: .9, show_expired: false, stale_days: 7, synthetic_extension: {preserve: true}},
    metadata: {created_at: stamp, updated_at: stamp, seed_version: 'synthetic-only'},
    migration: {applied_seed_ids: ['synthetic-only']}, synthetic_extension: {description: 'Synthetic fixture; no private source'},
  };
}

export function emptySynthetic() {
  const d = syntheticData();
  return {...d, revision: 0, employers: [], jobs: [], applications: [], metadata: {...d.metadata, seed_version: 'empty'}};
}
