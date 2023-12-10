import {loadFixture} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { parseUnits, keccak256, encodeAbiParameters } from 'viem';
import hre from "hardhat";
import orderType from "./utils/orderType";
import { seaportAddress, zeroHash } from "./utils/constants";
import generateSalt from "./utils/generateSalt";
import getBlockTimestamp from "./utils/getBlockTimestamp";
import seaportFixture from "./fixtures/seaportFixture";
import accountsFixture from "./fixtures/accountsFixture";

describe("RestrictToAddressesBySignature Zone tests", function () {

    async function fixture() {
        const sf = await seaportFixture();
        const af = await accountsFixture();

        const restrictToAddressesZone = await hre.viem.deployContract('RestrictToAddressesBySignature');

        return {
            ...sf,
            ...af,
            restrictToAddressesZone
        }
    }

    describe("erc20<->erc20", function () {

        /*
            Restrict the trade to a specific set of takers
            - only allow complete fills
            - we expect that after one taker fills the order, others can't do the same after
        */
        it("multiple recipients, complete fill by first", async function () {
            const { 
                alice, 
                bob, 
                charlie, 
                dan,
                seaport, 
                usdc, 
                weth, 
                getSeaport, 
                getUsdc, 
                getWeth, 
                aliceStartingUsdcBalance, 
                startingWethBalance, 
                restrictToAddressesZone 
            } = await loadFixture(fixture);

            // amounts
            const timestamp = await getBlockTimestamp();
            const usdcTradeAmount = parseUnits("1000", 6);
            const wethTradeamount = parseUnits("1", 18);

            // alice will designate that only bob and charlie can fill the trade
            // alice, bob, and charlie approve seaport contract
            await (await getUsdc(alice)).write.approve([
                seaportAddress,
                usdcTradeAmount
            ]);
            await (await getWeth(bob)).write.approve([
                seaportAddress,
                wethTradeamount
            ]);
            await (await getWeth(charlie)).write.approve([
                seaportAddress,
                wethTradeamount
            ]);

            // alice computes the merkle root
            // leaf nodes are just bob and charlie, so the root is the hash of those two
            const hashBob = keccak256(bob.account.address);
            const hashCharlie = keccak256(charlie.account.address);
            const concatenatedAddresses = hashBob < hashCharlie ? hashBob + hashCharlie.slice(2) : hashCharlie + hashBob.slice(2);
            const merkleRoot = keccak256(concatenatedAddresses as `0x${string}`);

            // construct order
            const salt = generateSalt();
            const baseOrderParameters = {
                offerer: alice.account.address,
                zone: restrictToAddressesZone.address,

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
                        startAmount: wethTradeamount,
                        endAmount: wethTradeamount,
                        recipient: alice.account.address,
                    }
                ],
                orderType: 2, // full restricted
                startTime: timestamp,
                endTime: timestamp + 86400n, // 24 hours from now

                // this will be used for verification by the zone contract
                zoneHash: merkleRoot, 

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

            // bob finds the hashes necessary to compute the merkle root from the hash of his address
            // in this case, just the hash of charlie's address
            // NOTE: for sake of privacy, alice can provide the merkle tree to bob, without necessarily revealing the underlying addresses
            const necessaryHashes = encodeAbiParameters(
                [{ type: 'bytes32[]', name: 'extraData' }],
                [[hashCharlie]]
            );

            // construct advanced order
            const advancedOrder = {
                parameters: orderParameters,
                numerator: wethTradeamount,
                denominator: wethTradeamount,
                signature: signature,
                extraData: necessaryHashes
            }

            // although alice intends for bob or charlie to fill the order,
            // let's pretend that dan somehow intercepts alice's signed message and the merkle tree
            // dan should still not be able to fill the order
            await (await getWeth(dan)).write.approve([
                seaportAddress,
                wethTradeamount
            ]);
            await expect(
                (await getSeaport(dan)).write.fulfillAdvancedOrder([
                    advancedOrder,
                    [],
                    zeroHash,
                    dan.account.address
                ])
            ).to.be.rejectedWith(
                'ORDER_RESTRICTED'
            );

            // bob will take the swap
            // check for expected starting balances
            expect(await usdc.read.balanceOf([alice.account.address])).to.eq(aliceStartingUsdcBalance);
            expect(await weth.read.balanceOf([alice.account.address])).to.eq(0n);
            expect(await weth.read.balanceOf([bob.account.address])).to.eq(startingWethBalance);
            expect(await usdc.read.balanceOf([bob.account.address])).to.eq(0n);

            await (await getSeaport(bob)).write.fulfillAdvancedOrder([
                advancedOrder,
                [],
                zeroHash,
                bob.account.address
            ]);

            // check that the swap was correct
            expect(await weth.read.balanceOf([alice.account.address])).to.eq(wethTradeamount);
            expect(await usdc.read.balanceOf([alice.account.address])).to.eq(0n);
            expect(await usdc.read.balanceOf([bob.account.address])).to.eq(usdcTradeAmount);
            expect(await weth.read.balanceOf([bob.account.address])).to.eq(0n);

            // charlie tries to fill the order
            const necessaryHashes2 = encodeAbiParameters(
                [{ type: 'bytes32[]', name: 'extraData' }],
                [[hashBob]]
            );
            const advancedOrder2 = {
                parameters: orderParameters,
                numerator: wethTradeamount,
                denominator: wethTradeamount,
                signature: signature,
                extraData: necessaryHashes2
            }
            await expect(
                (await getSeaport(charlie)).write.fulfillAdvancedOrder([
                    advancedOrder2,
                    [],
                    zeroHash,
                    charlie.account.address
                ])
            ).to.be.rejectedWith(
                'VM Exception while processing transaction: reverted with an unrecognized custom error'
            );
        });

        /*
            Restrict the trade to a specific set of takers
            - allow partial fills
        */
        it("multiple recipients, partial fills", async function () {
            const { 
                alice, 
                bob, 
                charlie, 
                dan,
                erin,
                seaport, 
                usdc, 
                weth, 
                getSeaport, 
                getUsdc, 
                getWeth, 
                aliceStartingUsdcBalance, 
                startingWethBalance, 
                restrictToAddressesZone
            } = await loadFixture(fixture);

            // amounts
            const timestamp = await getBlockTimestamp();
            const usdcTradeAmount = parseUnits("1000", 6);
            const wethTradeamount = parseUnits("1", 18);

            // alice will designate that bob, charlie, and dan can fill the trade
            // alice, bob, charlie, and dan approve seaport contract
            await (await getUsdc(alice)).write.approve([
                seaportAddress,
                usdcTradeAmount
            ]);
            await (await getWeth(bob)).write.approve([
                seaportAddress,
                wethTradeamount
            ]);
            await (await getWeth(charlie)).write.approve([
                seaportAddress,
                wethTradeamount
            ]);
            await (await getWeth(dan)).write.approve([
                seaportAddress,
                wethTradeamount
            ]);

            /*
                alice computes the merkle root
                leaf nodes are bob, charlie, and dan

                     hBCD
                    /    \
                  hBC    hD
                 /   \
                hB   hC
            */
            const hB = keccak256(bob.account.address);
            const hC = keccak256(charlie.account.address);
            const hD = keccak256(dan.account.address);
            const hBC = keccak256((hB < hC ? hB + hC.slice(2) : hC + hB.slice(2)) as `0x${string}`);
            const merkleRoot = keccak256((hBC < hD ? hBC + hD.slice(2) : hD + hBC.slice(2)) as `0x${string}`);

            // construct order
            const salt = generateSalt();
            const baseOrderParameters = {
                offerer: alice.account.address,
                zone: restrictToAddressesZone.address,

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
                        startAmount: wethTradeamount,
                        endAmount: wethTradeamount,
                        recipient: alice.account.address,
                    }
                ],
                orderType: 3, // partial restricted
                startTime: timestamp,
                endTime: timestamp + 86400n, // 24 hours from now

                // this will be used for verification by the zone contract
                zoneHash: merkleRoot,

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

            /*
                bob finds the hashes necessary to compute the merkle root from the hash of his address

                we can see that hC and hD are needed:

                     root
                    /    \
                  ___    hD
                 /   \
                __   hC
            */
            const necessaryHashes = encodeAbiParameters(
                [{ type: 'bytes32[]', name: 'extraData' }],
                [[hC, hD]]
            );
            const advancedOrder = {
                parameters: orderParameters,
                numerator: wethTradeamount / 2n,
                denominator: wethTradeamount,
                signature: signature,
                extraData: necessaryHashes
            }

            // although alice intends for bob, charlie, and dan to fill the order,
            // let's pretend that erin somehow intercepts alice's signed message
            // erin should still not be able to fill the order
            await (await getWeth(erin)).write.approve([
                seaportAddress,
                wethTradeamount
            ]);
            await expect(
                (await getSeaport(erin)).write.fulfillAdvancedOrder([
                    advancedOrder,
                    [],
                    zeroHash,
                    erin.account.address
                ])
            ).to.be.rejectedWith(
                'ORDER_RESTRICTED'
            );

            // bob and charlie will each take half the swap

            // check for expected starting balances
            expect(await usdc.read.balanceOf([alice.account.address])).to.eq(aliceStartingUsdcBalance);
            expect(await weth.read.balanceOf([alice.account.address])).to.eq(0n);
            expect(await weth.read.balanceOf([bob.account.address])).to.eq(startingWethBalance);
            expect(await usdc.read.balanceOf([bob.account.address])).to.eq(0n);

            // bob receives the signed order and fulfills half of it
            await (await getSeaport(bob)).write.fulfillAdvancedOrder([
                advancedOrder,
                [],
                zeroHash,
                bob.account.address
            ]);

            // check that the swap was correct
            expect(await weth.read.balanceOf([alice.account.address])).to.eq(wethTradeamount / 2n);
            expect(await usdc.read.balanceOf([alice.account.address])).to.eq(usdcTradeAmount / 2n);
            expect(await usdc.read.balanceOf([bob.account.address])).to.eq(usdcTradeAmount / 2n);
            expect(await weth.read.balanceOf([bob.account.address])).to.eq(wethTradeamount / 2n);

            // check charlie's expected starting balances
            expect(await usdc.read.balanceOf([charlie.account.address])).to.eq(0n);
            expect(await weth.read.balanceOf([charlie.account.address])).to.eq(startingWethBalance);

            /*
                charlie finds the hashes necessary to compute the merkle root from the hash of his address

                we can see that hB and hD are needed:

                     root
                    /    \
                  ___    hD
                 /   \
                hB   __
            */
            const necessaryHashes2 = encodeAbiParameters(
                [{ type: 'bytes32[]', name: 'extraData' }],
                [[hB, hD]]
            );
            const advancedOrder2 = {
                parameters: orderParameters,
                numerator: wethTradeamount / 2n,
                denominator: wethTradeamount,
                signature: signature,
                extraData: necessaryHashes2
            }

            // charlie fills the rest of the order
            await (await getSeaport(charlie)).write.fulfillAdvancedOrder([
                advancedOrder2,
                [],
                zeroHash,
                charlie.account.address
            ]);

            // check that the swap was correct
            expect(await weth.read.balanceOf([alice.account.address])).to.eq(wethTradeamount);
            expect(await usdc.read.balanceOf([alice.account.address])).to.eq(0n);
            expect(await usdc.read.balanceOf([charlie.account.address])).to.eq(usdcTradeAmount / 2n);
            expect(await weth.read.balanceOf([charlie.account.address])).to.eq(wethTradeamount / 2n);

            /*
                dan finds the hashes necessary to compute the merkle root from the hash of his address

                we can see that just hBC is needed:

                     root
                    /    \
                  hBC    __
                 /   \
                __   __
            */
            const necessaryHashes3 = encodeAbiParameters(
                [{ type: 'bytes32[]', name: 'extraData' }],
                [[hBC]]
            );
            const advancedOrder3 = {
                parameters: orderParameters,
                numerator: wethTradeamount,
                denominator: wethTradeamount,
                signature: signature,
                extraData: necessaryHashes3
            }

            // now that the order is completely filled, dan's fulfillment should fail
            await expect(
                (await getSeaport(dan)).write.fulfillAdvancedOrder([
                    advancedOrder3,
                    [],
                    zeroHash,
                    dan.account.address
                ])
            ).to.be.rejectedWith(
                'VM Exception while processing transaction: reverted with an unrecognized custom error'
            );
        });
    });
});
