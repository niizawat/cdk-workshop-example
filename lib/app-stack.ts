import * as cdk from 'aws-cdk-lib';
import {
  aws_s3 as s3,
  aws_lambda as lambda,
  aws_apigateway as apigateway,
  aws_iam as iam,
  aws_s3_deployment as s3deploy,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3バケット（静的ファイル保存用）
    const websiteBucket = new s3.Bucket(this, 'TranslateWebsiteBucket', {
      bucketName: `translate-website-${this.account}-${this.region}`,
      publicReadAccess: false, // API Gateway経由でアクセスするためpublicアクセスは無効
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // バケット削除時にオブジェクトも削除
      autoDeleteObjects: true, // バケット削除時にオブジェクトも削除
    });

    // フロントエンドファイルのデプロイ
    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset('./frontend')],
      destinationBucket: websiteBucket,
    });
    
    
    // Lambda関数（翻訳処理用）
    const translateFunction = new lambda.Function(this, 'TranslateFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/translate'),
      timeout: cdk.Duration.seconds(30),
    });

    // Lambda関数にTranslateとComprehendの権限を付与
    translateFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'translate:TranslateText',
        'comprehend:DetectDominantLanguage'
      ],
      resources: ['*']
    }));


    // API Gateway（REST API）
    const api = new apigateway.RestApi(this, 'TranslateApi', {
      restApiName: 'Translate Service',
      description: 'AWS Translateを使用した翻訳API',
      // バイナリメディアタイプを設定（画像、CSS、JSファイルなど）
      binaryMediaTypes: [
        'image/*',
        'text/css',
        'application/javascript',
        'application/json',
        'text/html',
        'text/plain',
        'font/*'
      ]
    });

    // 翻訳用Lambda統合
    const translateIntegration = new apigateway.LambdaIntegration(translateFunction);

    // /translateエンドポイントの作成
    const translateResource = api.root.addResource('translate');
    translateResource.addMethod('POST', translateIntegration);

    // API GatewayがS3にアクセスするためのIAMロール
    const apiGatewayS3AccessRole = new iam.Role(this, 'ApiGatewayS3AccessRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
    });

    // S3バケットの読み取り権限をAPI Gatewayに付与
    websiteBucket.grantRead(apiGatewayS3AccessRole);

    // ルートパス（/）用のS3統合 - S3バケットのindex.htmlを返す
    const rootIntegration = new apigateway.AwsIntegration({
      service: 's3',
      integrationHttpMethod: 'GET',
      path: `${websiteBucket.bucketName}/index.html`,
      options: {
        credentialsRole: apiGatewayS3AccessRole,
        passthroughBehavior: apigateway.PassthroughBehavior.WHEN_NO_TEMPLATES,
        integrationResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Content-Type': 'integration.response.header.Content-Type',
              'method.response.header.Content-Length': 'integration.response.header.Content-Length',
              'method.response.header.Timestamp': 'integration.response.header.Date'
            }
          },
          {
            statusCode: '400',
            selectionPattern: '4\\d{2}'
          },
          {
            statusCode: '500',
            selectionPattern: '5\\d{2}'
          }
        ]
      }
    });

    api.root.addMethod('GET', rootIntegration, {
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Content-Type': true,
            'method.response.header.Content-Length': true,
            'method.response.header.Timestamp': true
          }
        },
        {
          statusCode: '400'
        },
        {
          statusCode: '500'
        }
      ]
    });

    // 静的ファイル配信用のプロキシリソース（S3直接統合）
    const proxyIntegration = new apigateway.AwsIntegration({
      service: 's3',
      integrationHttpMethod: 'GET',
      path: `${websiteBucket.bucketName}/{proxy}`,
      options: {
        credentialsRole: apiGatewayS3AccessRole,
        passthroughBehavior: apigateway.PassthroughBehavior.WHEN_NO_TEMPLATES,
        requestParameters: {
          'integration.request.path.proxy': 'method.request.path.proxy'
        },
        integrationResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Content-Type': 'integration.response.header.Content-Type',
              'method.response.header.Content-Length': 'integration.response.header.Content-Length',
              'method.response.header.Timestamp': 'integration.response.header.Date'
            }
          },
          {
            statusCode: '400',
            selectionPattern: '4\\d{2}'
          },
          {
            statusCode: '500',
            selectionPattern: '5\\d{2}'
          }
        ]
      }
    });

    const proxyResource = api.root.addResource('{proxy+}');
    proxyResource.addMethod('GET', proxyIntegration, {
      requestParameters: {
        'method.request.path.proxy': true
      },
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Content-Type': true,
            'method.response.header.Content-Length': true,
            'method.response.header.Timestamp': true
          }
        },
        {
          statusCode: '400'
        },
        {
          statusCode: '500'
        }
      ]
    });

    // 出力値の設定
    new cdk.CfnOutput(this, 'WebsiteURL', {
      value: api.url,
      description: 'Website URL (via API Gateway)'
    });

    new cdk.CfnOutput(this, 'ApiGatewayURL', {
      value: api.url,
      description: 'API Gateway URL'
    });

    new cdk.CfnOutput(this, 'BucketName', {
      value: websiteBucket.bucketName,
      description: 'S3 Bucket Name'
    });

  }
}
