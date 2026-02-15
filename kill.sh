#!/bin/bash

echo "🦞 KILLGame Installer Starting..."

# 1. Scaffolding
mkdir -p agents/sniper agents/fortress agents/seed
touch .env

# 2. Generate package.json
cat <<EOT > package.json
{
  "name": "kill",
  "version": "1.0.0",
  "bin": { "killgame": "./cli.js" },
  "dependencies": {
    "commander": "^11.0.0",
    "inquirer": "^8.2.4",
    "dotenv": "^16.4.5",
    "ethers": "^5.7.2",
    "hardhat": "^2.28.4"
  }
}
EOT

# 3. Create cli.js
cat <<EOT > cli.js
#!/usr/bin/env node
const { program } = require('commander');
const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

program.version('1.0.0');

program
  .command('setup')
  .action(async () => {
    const answers = await inquirer.prompt([
      { type: 'list', name: 'role', choices: ['sniper', 'fortress', 'seed'], message: 'Agent:' },
      { type: 'input', name: 'pk', message: 'Private Key:' }
    ]);
    const envPath = path.join(process.cwd(), '.env');
    fs.appendFileSync(envPath, \`\${answers.role.toUpperCase()}_PK=\${answers.pk}\n\`);
    console.log('✅ Keys linked.');
  });

program
  .command('start <role>')
  .action((role) => {
    const agentPath = path.join('agents', role, 'agent.js');
    spawn('npx', ['hardhat', 'run', agentPath, '--network', 'basesepolia'], { stdio: 'inherit', shell: true });
  });

program.parse(process.argv);
EOT

# 4. Generate the 3 Full Files (Placeholders for this step)
echo "// Sniper Logic" > agents/sniper/agent.js
echo "// Fortress Logic" > agents/fortress/agent.js
echo "// Seed Logic" > agents/seed/agent.js

# 5. Finalize Environment
chmod +x cli.js
npm install
npm link --force

echo "------------------------------------------------"
echo "🎉 Done! Usage: 'killgame setup' then 'killgame start <role>'"