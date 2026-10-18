// Observe only changed form regions; control writes and UI decorations do not
// require another whole-page search.
const UI="#applykaro-root,#applykaro-field-root";
export function dependencyPriority(field, ruleId="") {
  if (/country/i.test(ruleId)) return 0;
  if (/university|school/i.test(ruleId)) return 1;
  if (["checkbox","switch"].includes(field.kind)) return 2;
  if (/state|province|degree/i.test(ruleId)) return 3;
  return 4;
}
export function trackDependencies(root=document) {
  const regions=new Set();
  const observer=new MutationObserver(records=>{
    for(const record of records) {
      const target=record.target.nodeType===1?record.target:record.target.parentElement;
      if(!target || target.closest?.(UI))continue;
      const added=[...record.addedNodes].filter(n=>n.nodeType===1 && !n.matches?.(UI) && !n.closest?.(UI));
      if(record.type==="childList" && added.some(n=>n.matches?.('input,select,textarea,[role="combobox"]') || n.querySelector?.('input,select,textarea,[role="combobox"]'))) regions.add(target);
      if(record.type==="attributes" && ["disabled","hidden","aria-hidden"].includes(record.attributeName))regions.add(target.parentElement||target);
    }
  });
  observer.observe(root.documentElement||root,{childList:true,subtree:true,attributes:true,attributeFilter:["disabled","hidden","aria-hidden"]});
  return { take:()=>{const out=[...regions].filter(n=>n.isConnected);regions.clear();return out.filter(n=>!out.some(other=>other!==n&&other.contains(n)));},dispose:()=>observer.disconnect() };
}
