export const toSqlite = (sql) => {
  let s = String(sql);

  s = s.replace(
    /DATE_SUB\(\s*CURDATE\(\)\s*,\s*INTERVAL\s+(\d+)\s+DAY\s*\)/g,
    (_match, days) => `date('now','localtime','-${days} days')`,
  );
  s = s.replace(
    /DATE_SUB\(\s*NOW\(\)\s*,\s*INTERVAL\s+(\d+)\s+DAY\s*\)/g,
    (_match, days) => `datetime('now','localtime','-${days} days')`,
  );
  s = s.replace(/DATE_FORMAT\(\s*([^,]+),\s*'%d'\s*\)/g, (_match, expr) => `strftime('%d', ${expr.trim()})`);
  s = s.replace(/CURDATE\(\)/g, "date('now','localtime')");
  s = s.replace(/NOW\(\)/g, "datetime('now','localtime')");
  s = s.replace(/\bDATE\(/g, 'date(');
  s = s.replace(/\s+FOR UPDATE\b/g, '');
  s = s.replace(/`/g, '"');
  s = s.replace(
    /ON DUPLICATE KEY UPDATE\s+"value"\s*=\s*VALUES\("value"\)/gi,
    'ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"',
  );

  return s;
};

export const isReadQuery = (sql) => /^\s*(SELECT|WITH|PRAGMA|EXPLAIN)\b/i.test(sql);

export const mapSqliteError = (error) => {
  const message = String(error?.message || '');
  if (/UNIQUE constraint failed/i.test(message)) {
    error.code = 'ER_DUP_ENTRY';
  } else if (/FOREIGN KEY constraint failed/i.test(message)) {
    error.code = 'ER_ROW_IS_REFERENCED_2';
  }
  return error;
};
