import { firebase, functions } from '../service/firebase';
import { Request } from 'firebase-functions/lib/providers/https';
import { Response } from 'express-serve-static-core';
import { Token } from '../config/token';
import { BuildInfo, CiBuilds } from '../model/ciBuilds';
import { CiJobs } from '../model/ciJobs';
import { Discord } from '../service/discord';
import { EditorVersionInfo } from '../model/editorVersionInfo';
import { RepoVersionInfo } from '../model/repoVersionInfo';
import { Image, ImageType } from '../model/image';

export const reportNewBuild = functions.https.onRequest(async (req: Request, res: Response) => {
  try {
    if (!Token.isValid(req.header('authorization'))) {
      firebase.logger.warn('unauthorised request', req.headers);
      res.status(403).send('Unauthorized');
      return;
    }

    const { body } = req;
    firebase.logger.debug('new incoming build report', body);

    const { buildId, jobId, imageType, baseOs, repoVersion, editorVersion, targetPlatform } = body;
    const buildInfo: BuildInfo = {
      baseOs,
      repoVersion,
      editorVersion,
      targetPlatform,
    };

    if (jobId.toString().startsWith('dryRun')) {
      await createDryRunJob(jobId, imageType, editorVersion);
    }

    await CiJobs.markJobAsInProgress(jobId);
    await CiBuilds.registerNewBuild(buildId, jobId, imageType, buildInfo);

    firebase.logger.info('new build reported', body);
    res.status(200).send('OK');
  } catch (err) {
    const message = `
      Something went wrong while wrong while reporting a new build.
      ${err.message}
    `;
    firebase.logger.error(message, err);
    await Discord.sendAlert(message);

    if (req.body?.jobId?.toString().startsWith('dryRun')) {
      await CiBuilds.removeDryRunBuild(req.body.buildId);
      await CiJobs.removeDryRunJob(req.body.jobId);
    }

    res.status(500).send('Something went wrong');
  }
});

const createDryRunJob = async (jobId: string, imageType: ImageType, editorVersion: string) => {
  firebase.logger.debug('running dryrun for image', imageType, editorVersion);
  const repoVersionInfo = await RepoVersionInfo.getLatest();

  if (imageType === Image.types.editor) {
    const editorVersionInfo = await EditorVersionInfo.get(editorVersion);
    await CiJobs.create(jobId, imageType, repoVersionInfo, editorVersionInfo);
  } else {
    await CiJobs.create(jobId, imageType, repoVersionInfo);
  }
};
