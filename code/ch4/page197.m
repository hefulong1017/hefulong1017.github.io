for ii=1:4
x1 = 0; x2 = 1; t1 = 0; t2 = 1;
M=10*2^(ii-1);
N=10*2^(ii-1);
h = (x2-x1)/M; dt = (t2-t1)/N;
s =dt /h;
x = x1:h:x2; x = x';
t = t1:dt:t2; t = t';
u = zeros(M+1,N+1);
u(1,:)=exp(t);
u(M+1,:)=exp(1+t);
u(:,1)=exp(x);
row1 = zeros(M-1, 1);
row1(2, 1) = -s^2/2;row1(1, 1) = 2+s^2; 
A=toeplitz(row1);
row2 = zeros(M-1, 1);
row2(2, 1) = s^2/2;row2(1, 1) = 2-s^2; 
B=toeplitz(row2);
row3 = zeros(M-1, 1);
row3(2, 1) = -s^2/2;row3(1, 1) = 1+s^2; 
C=toeplitz(row3);
row4 = zeros(M-1, 1);
row4(2, 1) = s^2/2;row4(1, 1) = -1-s^2; 
D=toeplitz(row4);
for k = 2:N
     H1 = zeros(M-1, 1);
    H1(1, 1) =(s^2/2)*(u(1,1)+u(1,2));
    
    H1(M-1, 1) =(s^2/2)*(u(M+1,1)+u(M+1,2));

u(2:M,2)=A\(B*u(2:M,1)+H1+2*dt*exp(x(2:M)));
end
for k = 2:N
     H = zeros(M-1, 1);
    H(1, 1) =s^2/2*(u(1,k+1)+u(1,k-1));
    
    H(M-1, 1) =s^2/2*(u(M+1,k+1)+u(M+1,k-1));

u(2:M,k+1)=C\(D*u(2:M,k-1)+H+2*u(2:M,k));
end
% 计算误差
F = zeros(M+1, N+1);
for i = 1:M+1
    for j = 1:N+1
        F(i, j) =exp(x(i)+t(j));
    end
end
error = abs(u-F);
MaxErr(ii) = max(max(error));
disp( MaxErr(ii));
figure(1)
hold on
plot(x,abs(u(:,1+N)-F(:,1+N)))
end
for j=1:3
Ord = (MaxErr(j)/MaxErr(j+1));
disp(['收敛阶为：',num2str(Ord)])
end
figure(2)
plot(x,u(:,1+N));
figure(3)
plot(x,F(:,1+N));
    [X, T] = meshgrid(x, t);
error = error';
    figure(4)
    mesh(X, T, error);
 