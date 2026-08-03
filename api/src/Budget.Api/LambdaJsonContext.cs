using System.Text.Json.Serialization;
using Amazon.Lambda.APIGatewayEvents;

namespace Budget.Api;

/// <summary>
/// Serializer context for the Lambda invocation envelope itself. Without this the
/// hosting layer falls back to reflection-based JSON, which compiles cleanly and
/// then fails at runtime once the app is published with Native AOT.
/// </summary>
[JsonSerializable(typeof(APIGatewayHttpApiV2ProxyRequest))]
[JsonSerializable(typeof(APIGatewayHttpApiV2ProxyResponse))]
internal sealed partial class LambdaJsonContext : JsonSerializerContext;
