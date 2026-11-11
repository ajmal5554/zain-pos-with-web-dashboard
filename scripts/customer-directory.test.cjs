const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ts = require('typescript');

function loadTsModule(filePath) {
    const source = fs.readFileSync(filePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
        },
    }).outputText;
    const mod = { exports: {} };
    new Function('require', 'exports', 'module', compiled)(require, mod.exports, mod);
    return mod.exports;
}

const dir = loadTsModule(path.resolve(__dirname, '../src/lib/customerDirectory.ts'));

test('buildCustomerDismissalKeys extracts normalized phone key and name key when phone absent', () => {
    assert.deepEqual(
        dir.buildCustomerDismissalKeys({ id: 'sale-cust-7025517977', name: 'Customer 7025517977', phone: '+91 70255 17977' }),
        ['phone:7025517977']
    );
    assert.deepEqual(
        dir.buildCustomerDismissalKeys({ id: 'sale-cust-ajith', name: 'ajith', phone: null }),
        ['name:ajith']
    );
    assert.deepEqual(
        dir.buildCustomerDismissalKeys({ id: 'cust-1', name: 'Walk-in Customer', phone: null }),
        []
    );
});

test('isSaleCustomerDismissed hides past demo sales but allows brand-new sales after dismissal', () => {
    const dismissedAt = 1794384885051;
    const map = {
        'phone:7025517977': dismissedAt,
        'name:fazil': dismissedAt,
    };

    assert.equal(
        dir.isSaleCustomerDismissed(
            { customerPhone: '7025517977', customerName: 'Customer 7025517977', createdAt: 1791988005029 },
            map
        ),
        true
    );
    assert.equal(
        dir.isSaleCustomerDismissed(
            { customerPhone: null, customerName: 'Fazil', createdAt: new Date(dismissedAt - 5000).toISOString() },
            map
        ),
        true
    );
    assert.equal(
        dir.isSaleCustomerDismissed(
            { customerPhone: '7025517977', customerName: 'Returning Buyer', createdAt: dismissedAt + 60000 },
            map
        ),
        false
    );
    assert.equal(
        dir.isSaleCustomerDismissed(
            { customerPhone: '9995023011', customerName: 'Sreejith T', createdAt: 1793712440694 },
            map
        ),
        false
    );
});

test('findExistingCustomerMatches detects exact phone, exact name, and partial phone/name duplicates', () => {
    const customers = [
        { id: 'c1', name: 'Ajmal', phone: '7907814523', gstin: null },
        { id: 'c2', name: 'Azhar Store', phone: '7025517955', gstin: '32AAAAA0000A1Z5' },
        { id: 'c3', name: 'Sreejith T', phone: '9995023011', gstin: null },
    ];

    const byExactPhone = dir.findExistingCustomerMatches(customers, { name: 'Ajmal New', phone: '+91 79078 14523' });
    assert.equal(byExactPhone.exactMatch?.customer.id, 'c1');
    assert.equal(byExactPhone.exactMatch?.matchType, 'EXACT_PHONE');

    const byPartialPhone = dir.findExistingCustomerMatches(customers, { name: '', phone: '79078' });
    assert.equal(byPartialPhone.exactMatch, null);
    assert.equal(byPartialPhone.matches[0]?.customer.id, 'c1');
    assert.equal(byPartialPhone.matches[0]?.matchType, 'PARTIAL_PHONE');

    const bySimilarName = dir.findExistingCustomerMatches(customers, { name: 'Azh', phone: '' });
    assert.equal(bySimilarName.exactMatch, null);
    assert.equal(bySimilarName.matches[0]?.customer.id, 'c2');
    assert.equal(bySimilarName.matches[0]?.matchType, 'SIMILAR_NAME');

    const byExactNameExcluded = dir.findExistingCustomerMatches(customers, { name: 'Ajmal', phone: '', excludeId: 'c1' });
    assert.equal(byExactNameExcluded.matches.length, 0);
});

test('sanitizeCustomerNameInput strips digits and caps length cleanly', () => {
    assert.equal(dir.sanitizeCustomerNameInput('Rahul 9847 Sharma123'), 'Rahul  Sharma');
    assert.equal(dir.sanitizeCustomerNameInput('7907814523'), '');
    assert.equal(dir.sanitizeCustomerNameInput('A'.repeat(60)), 'A'.repeat(50));
});

