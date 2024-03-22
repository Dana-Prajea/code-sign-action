import * as core from '@actions/core';
import { promises as fs } from 'fs';
import path from 'path';
import util from 'util';
import { exec } from 'child_process';
import { env } from 'process';

const asyncExec = util.promisify(exec);
const certificateFileName = env['TEMP'] + '\\certificate.pfx';

const signtool = 'C:/Program Files (x86)/Windows Kits/10/bin/10.0.17763.0/x86/signtool.exe';

const signtoolFileExtensions = [
    '.dll', '.exe', '.sys', '.vxd',
    '.msix', '.msixbundle', '.appx',
    '.appxbundle', '.msi', '.msp',
    '.msm', '.cab', '.ps1', '.psm1'
];

function sleep(seconds: number) {
    if (seconds > 0)
        console.log(`Waiting for ${seconds} seconds.`);
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

async function createCertificatePfx() {
    const base64Certificate = core.getInput('certificate');
    const certificate = Buffer.from(base64Certificate, 'base64');
    if (certificate.length == 0) {
        console.log('The value for "certificate" is not set.');
        return false;
    }
    console.log(`Writing ${certificate.length} bytes to ${certificateFileName}.`);
    await fs.writeFile(certificateFileName, certificate);
    return true;
}

async function addCertificateToStore(){
    try {
        const password : string= core.getInput('password');
        if (password == ''){
            console.log("Password is required to add pfx certificate to store");
            return false; 
        }
        var command = `certutil -f -p ${password} -importpfx ${certificateFileName}` 
        console.log("Adding cert to store command: " + command); 
        const { stdout } = await asyncExec(command);
        console.log(stdout);
        return true;
    } catch(err) {
        console.log((err as any).stdout);
        console.log((err as any).stderr);
        return false;
    }
}

async function signWithSigntool(fileName: string) {
    try {
        // var command = `"${signtool}" sign /sm /t ${timestampUrl} /sha1 "1d7ec06212fdeae92f8d3010ea422ecff2619f5d"  /n "DanaWoo" ${fileName}`
        var vitalParameterIncluded = false; 
        var timestampUrl : string = core.getInput('timestampUrl');
        if (timestampUrl === '') {
          timestampUrl = 'http://timestamp.verisign.com/scripts/timstamp.dll'; // 'http://timestamp.digicert.com';//
        }
        var command = `"${signtool}" sign /sm /t ${timestampUrl}`
        const sha1 : string= core.getInput('certificatesha1');
        if (sha1 != ''){
            command = command + ` /sha1 "${sha1}"`
            vitalParameterIncluded = true; 
        }
        const name : string= core.getInput('certificatename');
        if (name != ''){
            vitalParameterIncluded = true; 
            command = command + ` /n "${name}"`
        }
        if (!vitalParameterIncluded){
            console.log("You need to include a NAME or a SHA1 Hash for the certificate to sign with.")
        }
        command = command + ` ${fileName}`; 
        console.log("Signing command: " + command); 
        const { stdout } = await asyncExec(command);
        console.log(stdout);
        return true;
    } catch(err) {
        console.log((err as any).stdout);
        console.log((err as any).stderr);
        return false;
    }
}

async function trySignFile(fileName: string) {
    console.log(`Signing ${fileName}.`);
    const extension = path.extname(fileName);
    for (let i=0; i< 10; i++) {
        await sleep(i);
        if (signtoolFileExtensions.includes(extension)) {
            if (await signWithSigntool(fileName))
                return;
        }
    }
    throw `Failed to sign '${fileName}'.`;
}

async function* getFiles(folder: string, recursive: boolean): any {
    const files = await fs.readdir(folder);
    for (const file of files) {
        const fullPath = `${folder}/${file}`;
        const stat = await fs.stat(fullPath);
        if (stat.isFile()) {
            const extension = path.extname(file);
            if (signtoolFileExtensions.includes(extension) || extension == '.nupkg')
                yield fullPath;
        }
        else if (stat.isDirectory() && recursive) {
            yield* getFiles(fullPath, recursive);
        }
    }
}

async function signFiles() {
    const folder = core.getInput('folder', { required: true });
    const recursive = core.getInput('recursive') == 'true';
    for await (const file of getFiles(folder, recursive)) {
        await trySignFile(file);
    }
}

async function run() {
    try {
        if (await createCertificatePfx())
        {
            if (await addCertificateToStore()) 
                await signFiles();
        }
    }
    catch (err) {
        core.setFailed(`Action failed with error: ${err}`);
    }
}

run();
