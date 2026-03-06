/**
 * Service Gateway — Transform Bootstrap
 *
 * Registers all default body, auth, and response strategies with the
 * global registry. Import this module once at application startup to
 * ensure all strategies are available before the first gateway request.
 */

import { registry } from './registry';

// ── Body Transforms ──
import { passthroughTransform } from './body/passthrough';
import { staticTransform } from './body/static';
import { templateTransform } from './body/template';
import { extractTransform } from './body/extract';
import { binaryTransform } from './body/binary';
import { formEncodeTransform } from './body/form-encode';

registry.registerBody(passthroughTransform);
registry.registerBody(staticTransform);
registry.registerBody(templateTransform);
registry.registerBody(extractTransform);
registry.registerBody(binaryTransform);
registry.registerBody(formEncodeTransform);

// ── Auth Strategies ──
import { bearerAuth } from './auth/bearer';
import { headerAuth } from './auth/header';
import { basicAuth } from './auth/basic';
import { queryAuth } from './auth/query';
import { awsS3Auth } from './auth/aws-s3';
import { noneAuth } from './auth/none';

registry.registerAuth(bearerAuth);
registry.registerAuth(headerAuth);
registry.registerAuth(basicAuth);
registry.registerAuth(queryAuth);
registry.registerAuth(awsS3Auth);
registry.registerAuth(noneAuth);

// ── Response Transforms ──
import { envelopeResponse } from './response/envelope';
import { rawResponse } from './response/raw';
import { streamingResponse } from './response/streaming';
import { fieldMapResponse } from './response/field-map';

registry.registerResponse(envelopeResponse);
registry.registerResponse(rawResponse);
registry.registerResponse(streamingResponse);
registry.registerResponse(fieldMapResponse);

export { registry };
export type {
  BodyTransformStrategy,
  BodyTransformContext,
  AuthStrategy,
  AuthContext,
  ResponseTransformStrategy,
  ResponseTransformContext,
} from './types';
