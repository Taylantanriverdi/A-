import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'functions/lib/**', 'functions/node_modules/**', 'migration/out/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-eval': 'error', 'no-implied-eval': 'error', 'no-new-func': 'error', 'no-script-url': 'error',
      'no-restricted-properties': ['error',
        { object: 'document', property: 'write', message: 'document.write yasak.' },
        { property: 'insertAdjacentHTML', message: 'Verilerle HTML üretmek yasak; h() kullanın.' }],
      'no-restricted-syntax': ['error',
        { selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]", message: 'innerHTML/outerHTML ataması yasak; h() ve textContent kullanın.' },
        { selector: "MemberExpression[property.name='dangerouslySetInnerHTML']", message: 'Yasak.' },
        { selector: "CallExpression[callee.property.name='setAttribute'][arguments.0.value=/^on/i]", message: 'Satır içi olay öznitelikleri yasak.' }],
    },
  },
  { files: ['tests/**'], rules: { 'no-script-url': 'off' } },
);
