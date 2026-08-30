const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');

const db = new DatabaseSync('subagent-history.sqlite');
const schema = fs.readFileSync('schema.sql', 'utf8');
db.exec(schema);
console.log('✅ Schema creado OK');
db.close();
