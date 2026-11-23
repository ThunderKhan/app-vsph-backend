/** Exact reviewed fields from frozen services/report-csv.js, no raw provider objects. */
export const columns=[
 ['Project ID','id'],['Project key','key'],['Project name','name'],['Status','status'],
 ['Owner','owner_name'],['Customer organization','organization_name'],['Due date','due_on'],
 ['Completed tasks','completed_tasks'],['Total tasks','total_tasks'],['Assigned to me','assigned_to_me'],
 ['Overdue tasks','overdue_tasks'],['Completed milestones','completed_milestones'],
 ['Pending milestones','pending_milestones'],['Open pull requests','open_prs'],
 ['PRs requesting review','prs_awaiting_requested_review'],['Failed build observations','failed_build_records'],
 ['Last repository sync','last_sync_at'],['Last project activity','last_activity_at'],
] as const;
function cell(value:unknown):string{
 let valueText=value===null||value===undefined?'':String(value).replaceAll('\u0000','');
 // Some spreadsheet applications skip whitespace before interpreting formulas.
 if(typeof value!=='number'&&(/^[\s\uFEFF]*[=+\-@]/u.test(valueText)||/^[\t\r\n]/.test(valueText)))
   valueText="'"+valueText;
 return '"'+valueText.replaceAll('"','""')+'"';
}
export function projectCsv(value:unknown):string {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid report');
 const report=value as Record<string,unknown>;
 if(!Array.isArray(report.projects)||report.projects.length>100)
   throw Error('Project report exceeds the reviewed export bound.');
 const rows:unknown[][]=[['Export scope','Generated at','Deployment status',...columns.map(c=>c[0])]];
 for(const raw of report.projects){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid project report');
  const project=raw as Record<string,unknown>;
  rows.push(['First 100 authorized matching projects',report.generatedAt,report.deploymentStatus,
   ...columns.map(c=>project[c[1]])]);
 }
 return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
