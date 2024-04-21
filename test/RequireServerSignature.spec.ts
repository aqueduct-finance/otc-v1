import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { parseUnits, encodeAbiParameters } from 'viem';
import hre from "hardhat";
import orderType from "./utils/orderType";
import { seaportAddress, zeroHash } from "./utils/constants";
import generateSalt from "./utils/generateSalt";
import getBlockTimestamp from "./utils/getBlockTimestamp";
import seaportFixture from "./fixtures/seaportFixture";
import accountsFixture from "./fixtures/accountsFixture";
import serverSignatureType from "./utils/serverSignatureType";

describe("RequireServerSignature Zone tests", function () {

    async function fixture() {
        const sf = await seaportFixture();
        const af = await accountsFixture();

        // set erin as the server owner
        const server = af.erin;
        const requireServerSignatureZone = await hre.viem.deployContract('RequireServerSignature', [server.account.address, 31337n]);
        async function getRequireServerSignatureZone(client: typeof af.alice) {
            return await hre.viem.getContractAt(
                "IRequireServerSignature",
                requireServerSignatureZone.address,
                {
                    walletClient: client
                }
            );
        }

        return {
            ...sf,
            ...af,
            server,
            requireServerSignatureZone,
            getRequireServerSignatureZone
        }
    }

    /*
        Alice creates an full/open trade, but restricts it to the RequireServerSignature zone

        Four tests:
        - valid signature, authorized
        - valid signature, past deadline
        - valid signature, not authorized
        - invalid signature
    */
    async function signatureValidationFixture() {
        const { 
            alice, 
            bob, 
            charlie,
            server,
            seaport, 
            usdc, 
            weth, 
            getSeaport, 
            getUsdc, 
            getWeth, 
            aliceStartingUsdcBalance, 
            startingWethBalance, 
            requireServerSignatureZone
        } = await fixture();

        // amounts
        const timestamp = await getBlockTimestamp();
        const usdcTradeAmount = parseUnits("1000", 6);
        const wethTradeAmount = parseUnits("1", 18);

        // alice, bob, and charlie (malicious) approve seaport contract
        await (await getUsdc(alice)).write.approve([
            seaportAddress,
            usdcTradeAmount
        ]);
        await (await getWeth(bob)).write.approve([
            seaportAddress,
            wethTradeAmount
        ]);
        await (await getWeth(charlie)).write.approve([
            seaportAddress,
            wethTradeAmount
        ]);

        // construct order
        const salt = generateSalt();
        const baseOrderParameters = {
            offerer: alice.account.address,
            zone: requireServerSignatureZone.address,

            // this is what the trader is giving
            offer: [
                {
                    itemType: 1, // 1 == erc20
                    token: usdc.address,
                    identifierOrCriteria: 0n, // criteria not used for erc20s
                    startAmount: usdcTradeAmount,
                    endAmount: usdcTradeAmount,
                }
            ],

            // what the trader expects to receive
            consideration: [
                {
                    itemType: 1,
                    token: weth.address,
                    identifierOrCriteria: 0n,
                    startAmount: wethTradeAmount,
                    endAmount: wethTradeAmount,
                    recipient: alice.account.address,
                }
            ],
            orderType: 2, // full restricted
            startTime: timestamp,
            endTime: timestamp + 86400n, // 24 hours from now

            // alice doesn't need to supply data to this zone, the fulfiller will provide the server signature in the 'extraData' param
            zoneHash: zeroHash,
            salt: salt,
            conduitKey: zeroHash, // not using a conduit
        };
        const orderParameters = {
            ...baseOrderParameters,
            totalOriginalConsiderationItems: 1n
        }

        // get contract info
        const info = await seaport.read.information();
        const version = info[0];
        const name = await seaport.read.name();
        const domainData = {
            name: name,
            version: version,

            // although we are forking eth mainnet, hardhat uses this chainId instead of the actual chainId (in this case, 1)
            chainId: 31337,
            verifyingContract: seaportAddress,
        };
        const counter = await seaport.read.getCounter([alice.account.address]);
        const orderComponents = {
            ...baseOrderParameters,
            counter: counter,
        }

        // alice signs the order
        const signature = await alice.signTypedData({
            domain: domainData,
            types: orderType,
            primaryType: 'OrderComponents',
            message: orderComponents
        });

        // server signs the order
        const orderHash = await seaport.read.getOrderHash([orderComponents]);
        const authParams = {
            orderHash: orderHash,
            fulfiller: bob.account.address,
            deadline: timestamp + 600n // 10 mins from now
        };
        const serverDomainData = {
            name: 'RequireServerSignature',
            version: '1.0',
            chainId: 31337,
            verifyingContract: requireServerSignatureZone.address,
        };
        const serverSignature = await server.signTypedData({
            domain: serverDomainData,
            types: serverSignatureType,
            primaryType: 'AuthParams',
            message: authParams
        });
        const serverToken = {
            authParams: authParams,
            signature: serverSignature
        };
        const encodedServerToken = encodeAbiParameters(
            [
                {
                    name: 'serverToken',
                    type: 'tuple',
                    components: [
                        {
                            name: 'authParams',
                            type: 'tuple',
                            components: [
                                { name: 'orderHash', type: 'bytes32' },
                                { name: 'fulfiller', type: 'address' },
                                { name: 'deadline', type: 'uint256' },
                            ],
                        },
                        { name: 'signature', type: 'bytes' },
                    ],
                }
            ],
            [serverToken]
        );

        // construct advanced order
        const advancedOrder = {
            parameters: orderParameters,
            numerator: wethTradeAmount,
            denominator: wethTradeAmount,
            signature: signature,
            extraData: encodedServerToken
        }

        return {
            alice,
            bob,
            charlie,
            aliceStartingUsdcBalance,
            startingWethBalance,
            usdc,
            weth,
            getUsdc,
            getWeth,
            getSeaport,
            usdcTradeAmount,
            wethTradeAmount,
            advancedOrder,
            serverToken,
            orderHash,
        }
    }

    /*
        Server sends a valid signature, and fulfiller meets the auth params
    */
    it("valid signature, authorized", async function () {
        const { 
            alice,
            bob,
            aliceStartingUsdcBalance,
            startingWethBalance,
            usdc,
            weth,
            getSeaport,
            usdcTradeAmount,
            wethTradeAmount,
            advancedOrder,
        } = await loadFixture(signatureValidationFixture);

        // check for expected starting balances
        expect(await usdc.read.balanceOf([alice.account.address])).to.eq(aliceStartingUsdcBalance);
        expect(await weth.read.balanceOf([alice.account.address])).to.eq(0n);
        expect(await weth.read.balanceOf([bob.account.address])).to.eq(startingWethBalance);
        expect(await usdc.read.balanceOf([bob.account.address])).to.eq(0n);

        // bob receives the server signature and the signed order, and fulfills it
        await (await getSeaport(bob)).write.fulfillAdvancedOrder([
            advancedOrder,
            [],
            zeroHash,
            bob.account.address
        ]);

        // check that the swap was correct
        expect(await weth.read.balanceOf([alice.account.address])).to.eq(wethTradeAmount);
        expect(await usdc.read.balanceOf([alice.account.address])).to.eq(0n);
        expect(await usdc.read.balanceOf([bob.account.address])).to.eq(usdcTradeAmount);
        expect(await weth.read.balanceOf([bob.account.address])).to.eq(0n);
    });

    /*
        Server sends a valid signature, but bob waits too long to fill the trade
    */
    it("valid signature, past deadline", async function () {
        const {
            bob,
            getSeaport,
            advancedOrder,
        } = await loadFixture(signatureValidationFixture);

        // order deadline is 10 mins, so let's skip ahead 1 hour
        await time.increase(3600);

        // bob tries to sign the order
        await expect(
            (await getSeaport(bob)).write.fulfillAdvancedOrder([
                advancedOrder,
                [],
                zeroHash,
                bob.account.address
            ])
        ).to.be.rejectedWith(
            'DEADLINE_EXCEEDED'
        );
    });

    /*
        Server sends a valid signature to bob, but charlie intercepts it
    */
    it("valid signature, not authorized", async function () {
        const { 
            charlie,
            getSeaport,
            advancedOrder,
        } = await loadFixture(signatureValidationFixture);

        // charlie tries to sign the order
        await expect(
            (await getSeaport(charlie)).write.fulfillAdvancedOrder([
                advancedOrder,
                [],
                zeroHash,
                charlie.account.address
            ])
        ).to.be.rejectedWith(
            'INCORRECT_FULFILLER'
        );
    });

    /*
        Charlie tries to modify the auth params, but the server's signature doesn't match
    */
    it("invalid signature", async function () {
        const {
            charlie,
            getSeaport,
            advancedOrder,
            serverToken
        } = await loadFixture(signatureValidationFixture);

        serverToken.authParams.fulfiller = charlie.account.address;
        const encodedServerToken = encodeAbiParameters(
            [
                {
                    name: 'serverToken',
                    type: 'tuple',
                    components: [
                        {
                            name: 'authParams',
                            type: 'tuple',
                            components: [
                                { name: 'orderHash', type: 'bytes32' },
                                { name: 'fulfiller', type: 'address' },
                                { name: 'deadline', type: 'uint256' },
                            ],
                        },
                        { name: 'signature', type: 'bytes' },
                    ],
                }
            ],
            [serverToken]
        );
        advancedOrder.extraData = encodedServerToken;

        // charlie tries to sign the order
        await expect(
            (await getSeaport(charlie)).write.fulfillAdvancedOrder([
                advancedOrder,
                [],
                zeroHash,
                charlie.account.address
            ])
        ).to.be.rejectedWith(
            'INVALID_SERVER_SIGNATURE'
        );
    });

    /*
        Bob tries to take the token from one order and use it for another
    */
    it("invalid order", async function () {
        // bob is stealing the token from this order
        const {
            bob,
            getSeaport,
            serverToken,
            orderHash
        } = await loadFixture(signatureValidationFixture);

        // order that bob will try to fill
        const {
            advancedOrder,
            orderHash: orderHash2
        } = await signatureValidationFixture();

        // order hashes shouldn't be the same
        expect(orderHash).to.not.equal(orderHash2);

        // manually change the orderHash
        serverToken.authParams.orderHash = orderHash2;
        const encodedServerToken = encodeAbiParameters(
            [
                {
                    name: 'serverToken',
                    type: 'tuple',
                    components: [
                        {
                            name: 'authParams',
                            type: 'tuple',
                            components: [
                                { name: 'orderHash', type: 'bytes32' },
                                { name: 'fulfiller', type: 'address' },
                                { name: 'deadline', type: 'uint256' },
                            ],
                        },
                        { name: 'signature', type: 'bytes' },
                    ],
                }
            ],
            [serverToken]
        );
        advancedOrder.extraData = encodedServerToken;

        // bob tries to sign the order
        await expect(
            (await getSeaport(bob)).write.fulfillAdvancedOrder([
                advancedOrder,
                [],
                zeroHash,
                bob.account.address
            ])
        ).to.be.rejectedWith(
            'INVALID_SERVER_SIGNATURE'
        );
    });
});
