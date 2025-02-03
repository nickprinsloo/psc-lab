import type { Construct } from "constructs";
import { App, TerraformStack } from "cdktf";
import { GoogleProvider } from "@cdktf/provider-google/lib/provider";
import { ComputeNetwork } from "@cdktf/provider-google/lib/compute-network";
import { ComputeSubnetwork } from "@cdktf/provider-google/lib/compute-subnetwork";
import { CloudRunV2Service } from "@cdktf/provider-google/lib/cloud-run-v2-service";
import { CloudRunV2ServiceIamMember } from "@cdktf/provider-google/lib/cloud-run-v2-service-iam-member";
import { ComputeAddress } from "@cdktf/provider-google/lib/compute-address";
import { ComputeRegionNetworkEndpointGroup } from "@cdktf/provider-google/lib/compute-region-network-endpoint-group";
import { ComputeRegionBackendService } from "@cdktf/provider-google/lib/compute-region-backend-service";
import { ComputeForwardingRule } from "@cdktf/provider-google/lib/compute-forwarding-rule";
import { ComputeRegionTargetHttpProxy } from "@cdktf/provider-google/lib/compute-region-target-http-proxy";
import { ComputeRegionUrlMap } from "@cdktf/provider-google/lib/compute-region-url-map";
import { ComputeServiceAttachment } from "@cdktf/provider-google/lib/compute-service-attachment";

const region = "europe-west2";

class StackA extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new GoogleProvider(this, "google", {
      project: "PROJECT-A",
      region,
    });

    const network = new ComputeNetwork(this, "network-a", {
      name: "network-a",
      autoCreateSubnetworks: false,
    });

    const subnetApp = new ComputeSubnetwork(this, "subnet-app", {
      name: "subnet-app",
      network: network.name,
      region,
      ipCidrRange: "10.0.0.0/24",
      purpose: "PRIVATE",
    });

    new ComputeSubnetwork(this, "subnet-proxy", {
      name: "subnet-proxy",
      network: network.name,
      region,
      ipCidrRange: "10.0.1.0/24",
      purpose: "REGIONAL_MANAGED_PROXY",
      role: "ACTIVE",
    });

    const subnetPSC = new ComputeSubnetwork(this, "subnet-psc", {
      name: "subnet-psc",
      network: network.name,
      region,
      ipCidrRange: "10.0.2.0/24",
      purpose: "PRIVATE_SERVICE_CONNECT",
    });

    const service = new CloudRunV2Service(this, "service", {
      name: "service",
      location: region,
      deletionProtection: false,
      ingress: "INGRESS_TRAFFIC_INTERNAL_ONLY",

      template: {
        containers: [{ image: "us-docker.pkg.dev/cloudrun/container/hello" }],
      },
    });

    new CloudRunV2ServiceIamMember(this, "invoker", {
      name: service.name,
      location: region,
      role: "roles/run.invoker",
      member: "allUsers",
    });

    new ComputeAddress(this, "loadbalancer-address", {
      name: "loadbalancer-address",
      region,
      subnetwork: subnetApp.name,
      addressType: "INTERNAL",
      address: "10.0.0.10",
      ipVersion: "IPV4",
    });

    const networkEndpointGroup = new ComputeRegionNetworkEndpointGroup(
      this,
      "network-endpoint-group",
      {
        name: "network-endpoint-group",
        region,
        networkEndpointType: "SERVERLESS",
        cloudRun: { service: service.name },
      }
    );

    const backendService = new ComputeRegionBackendService(
      this,
      "backend-service",
      {
        name: "backend-service",
        loadBalancingScheme: "INTERNAL_MANAGED",
        region,
        protocol: "HTTPS",
        backend: [{ group: networkEndpointGroup.id }],
      }
    );

    const urlMap = new ComputeRegionUrlMap(this, "url-map", {
      name: "url-map",
      region,
      defaultService: backendService.id,
    });

    const httpProxy = new ComputeRegionTargetHttpProxy(this, "http-proxy", {
      name: "http-proxy",
      region,
      urlMap: urlMap.id,
    });

    const forwardingRule = new ComputeForwardingRule(this, "forwarding-rule", {
      name: "forwarding-rule",
      region: region,
      ipProtocol: "TCP",
      loadBalancingScheme: "INTERNAL_MANAGED",
      portRange: "80",
      target: httpProxy.id,
      network: network.name,
      subnetwork: subnetApp.name,
      networkTier: "PREMIUM",
    });

    const computeService = new ComputeServiceAttachment(
      this,
      "psc-service-attachment",
      {
        name: "psc-service-attachment",
        region,
        targetService: forwardingRule.id,
        connectionPreference: "ACCEPT_MANUAL",
        natSubnets: [subnetPSC.id],
        enableProxyProtocol: false,
        consumerAcceptLists: [
          {
            networkUrl:
              "https://www.googleapis.com/compute/v1/projects/PROJECT-B/global/networks/default",
            connectionLimit: 10,
          },
        ],
      }
    );

    const consumerIP = new ComputeAddress(this, "consumer-ip", {
      name: "consumer-ip",
      region,
      subnetwork: "default",
      addressType: "INTERNAL",
      address: "10.154.0.5",
      ipVersion: "IPV4",
      project: "PROJECT-B",
    });

    new ComputeForwardingRule(this, "forwarding-rule-psc", {
      name: "psc-forwarding-rule",
      region,
      network: "default",
      subnetwork: "default",
      target: computeService.id,
      project: "PROJECT-B",
      loadBalancingScheme: "",
      ipAddress: consumerIP.id,
    });
  }
}

const app = new App();
new StackA(app, "lab");
app.synth();
