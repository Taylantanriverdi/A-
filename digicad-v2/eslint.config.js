import tseslint from 'typescript-eslint';

// Güvenlik odaklı yasaklar: verilerle HTML/kod üretimi (XSS) ve dinamik kod çalıştırma.
const HTML_SINKS = '/^(innerHTML|outerHTML|srcdoc)$/';
const restrictedSyntax = [
  { selector: `AssignmentExpression[left.property.name=${HTML_SINKS}]`, message: 'innerHTML/outerHTML/srcdoc ataması yasak; h() ve textContent kullanın.' },
  { selector: `AssignmentExpression[left.property.value=${HTML_SINKS}]`, message: 'innerHTML/outerHTML/srcdoc ataması yasak (köşeli parantezle de).' },
  { selector: `Property[key.name=${HTML_SINKS}]`, message: 'innerHTML/outerHTML/srcdoc özelliği (ör. Object.assign ile) yasak.' },
  { selector: `Property[key.value=${HTML_SINKS}]`, message: 'innerHTML/outerHTML/srcdoc özelliği yasak.' },
  { selector: "MemberExpression[property.name='dangerouslySetInnerHTML']", message: 'Yasak.' },
  { selector: "CallExpression[callee.property.name='setAttribute'][arguments.0.value=/^(on|style$|srcdoc$)/i]", message: 'Satır içi olay/style/srcdoc öznitelikleri yasak (CSP).' },
  { selector: "CallExpression[callee.object.name='document'][callee.property.name=/^(write|writeln)$/]", message: 'document.write yasak.' },
  { selector: "CallExpression[callee.object.property.name='document'][callee.property.name=/^(write|writeln)$/]", message: 'document.write yasak.' },
  { selector: "CallExpression[callee.property.name='execCommand'][arguments.0.value=/^insertHTML$/i]", message: 'execCommand(insertHTML) yasak.' },
  { selector: "CallExpression[callee.name=/^(setTimeout|setInterval|setImmediate)$/][arguments.0.type=/^(Literal|TemplateLiteral|BinaryExpression)$/]", message: 'setTimeout/setInterval ile metin (kod) çalıştırmak yasak; fonksiyon verin.' },
  { selector: "CallExpression[callee.property.name=/^(setTimeout|setInterval)$/][callee.object.name=/^(window|globalThis|self)$/][arguments.0.type=/^(Literal|TemplateLiteral|BinaryExpression)$/]", message: 'setTimeout/setInterval ile metin (kod) çalıştırmak yasak.' },
  { selector: "CallExpression[callee.name='h'] > ObjectExpression > Property[key.name=/^on[A-Za-z]/]", message: "h() ile satır içi olay yasak; `on: { click }` kullanın." },
  { selector: "CallExpression[callee.name='h'] > ObjectExpression > Property[key.name='style']", message: 'h() ile style özniteliği yasak (CSP); sınıf kullanın.' },
  { selector: "NewExpression[callee.name='Function']", message: 'new Function yasak.' },
  { selector: "CallExpression[callee.name='Function']", message: 'Function() yasak.' },
];

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'functions/lib/**', 'functions/node_modules/**', 'migration/out/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-eval': ['error', { allowIndirect: false }], 'no-implied-eval': 'error', 'no-new-func': 'error', 'no-script-url': 'error',
      'no-restricted-properties': ['error',
        { property: 'insertAdjacentHTML', message: 'Verilerle HTML üretmek yasak; h() kullanın.' },
        { property: 'createContextualFragment', message: 'HTML ayrıştırma yasak.' },
        { property: 'setHTMLUnsafe', message: 'Yasak.' },
        { object: 'Document', property: 'parseHTMLUnsafe', message: 'Yasak.' },
        { object: 'window', property: 'eval', message: 'eval yasak.' },
        { object: 'globalThis', property: 'eval', message: 'eval yasak.' }],
      'no-restricted-globals': ['error', { name: 'eval', message: 'eval yasak.' }],
      'no-restricted-syntax': ['error', ...restrictedSyntax],
    },
  },
  // Testler yasaklı kalıpları bilerek dener (örn. 'javascript:' URL'leri) ve izinli ayrıştırma yapabilir.
  {
    files: ['tests/**'],
    rules: {
      'no-script-url': 'off',
      // Güvenlik testleri h()'ye bilerek yasaklı öznitelikler verir; diğer yasaklar (eval, document.write, setTimeout(string)…) testlerde de geçerlidir.
      'no-restricted-syntax': ['error', ...restrictedSyntax.filter((r) => !r.selector.startsWith("CallExpression[callee.name='h']") && !r.selector.startsWith('Property['))],
    },
  },
);
