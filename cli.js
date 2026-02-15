#!/usr/bin/env node
const { program } = require('commander');
const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

program
  .version('0.0.1')
  .description('KILLGame Unified Agent CLI');

// COMMAND: SETUP
program
  .command('setup')
  .description('Configure an agent (Sniper, Fortress, or Seed)')
  .action(async () => {
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'role',
        message: 'Which agent type are you configuring?',
        choices: ['sniper', 'fortress', 'seed']
      },
      {
        type: 'input',
        name: 'hub',
        message: 'HUB_STACK ID (default: 125):',
        default: '125',
        when: (a) => a.role !== 'seed'
      },
      {
        type: 'input',
        name: 'pk',
        message: 'Private Key for this agent:'
      }
    ]);

    const configPath = path.join(__dirname, 'agents', answers.role, 'config.json');
    
    // Update config.json if it exists
    if (fs.existsSync(configPath)) {
        let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (answers.hub) config.settings.HUB_STACK = parseInt(answers.hub);
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    }

    // Centralize PK in root .env
    const envPath = path.join(__dirname, '.env');
    const envKey = `${answers.role.toUpperCase()}_PK`;
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : "";
    
    if (envContent.includes(envKey)) {
        envContent = envContent.replace(new RegExp(`${envKey}=.*`), `${envKey}=${answers.pk}`);
    } else {
        envContent += `\n${envKey}=${answers.pk}`;
    }
    
    fs.writeFileSync(envPath, envContent);
    console.log(`\n✅ ${answers.role.toUpperCase()} configured. Keys stored in root .env.`);
  });

// COMMAND: START
program
  .command('start <role>')
  .description('Launch an agent (sniper, fortress, seed)')
  .action((role) => {
    const agentPath = path.join('agents', role, 'agent.js');
    if (!fs.existsSync(agentPath)) {
        console.error(`Error: Agent script not found at ${agentPath}`);
        return;
    }

    console.log(`🚀 Launching ${role} agent...`);
    // Runs 'npx hardhat run agents/[role]/agent.js --network basesepolia'
    spawn('npx', ['hardhat', 'run', agentPath, '--network', 'basesepolia'], {
        stdio: 'inherit',
        shell: true
    });
  });

program.parse(process.argv);