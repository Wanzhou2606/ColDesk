import ts from 'typescript';
import type { Plugin } from 'vite';
/** 只转换构建副本，不批量改写源码。用户输入、导航标识和数据值不参与翻译。 */
export function uiLanguagePlugin():Plugin{return {name:'coldesk-ui-language',enforce:'pre',transform(source,id){
 if(!id.replaceAll('\\','/').includes('/src/renderer/src/')||!id.endsWith('.tsx'))return;
 const file=ts.createSourceFile(id,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),f=ts.factory;let used=false;
 const zh=(s:string)=>/[\u3400-\u9fff]/.test(s),text=(value:string,args?:ts.Expression[])=>{used=true;return f.createCallExpression(f.createIdentifier('_uiText'),undefined,[f.createStringLiteral(value),...(args?[f.createArrayLiteralExpression(args)]:[])]);};
 const result=ts.transform(file,[ctx=>{
 const label=(n:ts.Node):ts.VisitResult<ts.Node>=>{
  if(ts.isArrowFunction(n)||ts.isFunctionExpression(n))return ts.visitEachChild(n,visit,ctx);
  if(ts.isJsxElement(n)||ts.isJsxSelfClosingElement(n)||ts.isJsxFragment(n))return visit(n);
  if(ts.isStringLiteral(n)&&zh(n.text))return text(n.text);
  if(ts.isTemplateExpression(n)&&zh(n.head.text+n.templateSpans.map(s=>s.literal.text).join(''))){let key=n.head.text;const args:ts.Expression[]=[];n.templateSpans.forEach((s,i)=>{key+=`{${i}}`+s.literal.text;args.push(s.expression);});return text(key,args);}
  if(ts.isElementAccessExpression(n)&&ts.isIdentifier(n.expression)&&['NAV_LABELS','INTRO_STEPS','GRADE_LABELS'].includes(n.expression.text))return textCall(n);
  if(ts.isPropertyAccessExpression(n)&&n.name.text==='name'&&ts.isIdentifier(n.expression)&&['theme','option'].includes(n.expression.text))return textCall(n);
  if(ts.isPropertyAccessExpression(n)&&(['label','hint','meaning','scheduling','dateLabel','weekday','countdownLabel','budgetSourceLabel'].includes(n.name.text)||ts.isIdentifier(n.expression)&&['guide','message'].includes(n.expression.text)&&['title','text'].includes(n.name.text)))return textCall(n);
  if(ts.isIdentifier(n)&&['error','saveState','saveMessage','exportMessage','exportError','placementMessage','monthLabel','message','label'].includes(n.text)&&!(ts.isPropertyAccessExpression(n.parent)&&n.parent.name===n)&&!(ts.isPropertyAssignment(n.parent)&&n.parent.name===n))return textCall(n);
  if(ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&['humanDuration','weekdayCn','relativeDay','labelOf','weekLabel','countdownText'].includes(n.expression.text)){used=true;return f.createCallExpression(f.createIdentifier('_uiText'),undefined,[n]);}
  return ts.visitEachChild(n,label,ctx);
 };
 const textCall=(n:ts.Expression)=>{used=true;return f.createCallExpression(f.createIdentifier('_uiText'),undefined,[n]);};
 const visit=(n:ts.Node):ts.VisitResult<ts.Node>=>{
  if(ts.isJsxText(n)&&zh(n.text)){const s=n.text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).join(' ');return f.createJsxExpression(undefined,text(s));}
  if(ts.isJsxAttribute(n)&&n.initializer&&ts.isStringLiteral(n.initializer)&&zh(n.initializer.text)&&n.name.getText(file)!=='value')return f.updateJsxAttribute(n,n.name,f.createJsxExpression(undefined,text(n.initializer.text)));
  if(ts.isJsxExpression(n)&&n.expression)return f.updateJsxExpression(n,ts.visitNode(n.expression,label) as ts.Expression);
  return ts.visitEachChild(n,visit,ctx);
 };return n=>ts.visitNode(n,visit) as ts.SourceFile;
 }]);
 if(!used){result.dispose();return;}
 const code="import {t as _uiText} from '@shared/i18n';\n"+ts.createPrinter().printFile(result.transformed[0]);result.dispose();
 const checked=ts.createSourceFile(id,code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const errors=(checked as ts.SourceFile&{parseDiagnostics:ts.Diagnostic[]}).parseDiagnostics;if(errors.length)throw new Error('语言转换的构建副本语法错误：'+id+' '+errors.map(e=>ts.flattenDiagnosticMessageText(e.messageText,' ')+' '+code.slice(Math.max(0,(e.start??0)-60),(e.start??0)+60)).join('\n'));
 return {code,map:null};
}};}
