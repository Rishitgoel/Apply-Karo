import {startServer} from './server.mjs';
const server=await startServer();console.log(`Paired trial recorder: ${server.origin}/trials`);
for(const event of ['SIGINT','SIGTERM'])process.on(event,async()=>{await server.close();process.exit(0);});
