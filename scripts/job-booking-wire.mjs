export const jobWire = status => ({version: 1, kind: 'model', type: {kind: 'model', name: 'Job', symbol: 'job-booking@0.2.0:main.bmec:ModelDeclaration:8'}, fields: {
  customer: {version: 1, kind: 'model', type: {kind: 'model', name: 'Customer', symbol: 'job-booking@0.2.0:main.bmec:ModelDeclaration:6'}, fields: {id: {version: 1, kind: 'integer', value: '1'}}},
  worker: {version: 1, kind: 'model', type: {kind: 'model', name: 'User', symbol: 'job-booking@0.2.0:main.bmec:ModelDeclaration:5'}, fields: {id: {version: 1, kind: 'integer', value: '2'}}},
  workerAuthId: {version: 1, kind: 'text', value: 'worker'},
  title: {version: 1, kind: 'text', value: 'Postgres boiler repair'},
  description: {version: 1, kind: 'text', value: 'Persist status through PostgreSQL'},
  price: {version: 1, kind: 'money', minor: '125000', scale: 2},
  scheduledDate: {version: 1, kind: 'text', value: '2026-10-02'},
  status: {version: 1, kind: 'text', value: status},
}});
export const newJobWire = (status, workerAuthId = 'worker') => ({customer: 1, workerAuthId, title: 'Postgres boiler repair', description: 'Persist status through PostgreSQL', price: 1250, scheduledDate: '2026-10-02', status});
