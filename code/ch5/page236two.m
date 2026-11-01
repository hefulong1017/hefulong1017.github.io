for ii=1:5
     xa=0;xb=1;ya=0;yb=1;ta=0;tb=1;
     m1=10*2^(ii-1);
     m2=10*2^(ii-1);
    n=10*2^(ii-1);
    h1=(xb-xa)/m1;
    h2=(tb-ta)/n;
x=(0:m1)*h1+0;
y=(0:m2)*h1+0;
t=(0:n)*h2+0;t0=(0:n)*h2+1/2*h2;
for k=1:n+1
    for i=1:m2+1
        for j=1:m1+1
            f(i,j,k)=-3/2*exp(1/2*(x(j)+y(i))-t0(k)); 
    
        end
    end
end

for i=1:m2+1
    for j=1:m1+1
    u(i,j,1)=exp(1/2*(x(j)+y(i)));
    end
end

for k=1:n+1
    for i=1:m2+1
        u(i,[1 m1+1],k)=[exp(1/2*y(i)-t(k)) exp(1/2*(1+y(i))-t(k))];
    end
end
r=h2/(h1*h1);r4=1+r;r5=r/2;
for k=1:n
    for i=2:m2
        u0(i,[1 m1+1],k)=r4*u(i,[1 m1+1],k+1)-r5*(u(i-1,[1 m1+1],...
            k+1)+u(i+1,[1 m1+1],k+1));  
    end
end
for k=1:n+1
    for j=1:m1+1
        u([1 m2+1],j,k)=[exp(1/2*x(j)-t(k)) exp(1/2*(1+x(j))-t(k))];
    end
end
r1=r-r*r;r2=2*(r-1)*(r-1);r3=r*r/2;
for k=1:n  
    for i=2:m2 
        a=-r*ones(1,m1-1);
        c=a;a(1)=0;c(m1-1)=0;
        b=2*r4*ones(1,m1-1);
        d(1)=r*u0(i,1,k)+r1*(u(i-1,2,k)+u(i,1,k)+u(i+1,2,k)+...
            u(i,3,k))+r2*u(i,2,k)+r3*(u(i-1,1,k)+...
            u(i+1,1,k)+u(i-1,3,k)+u(i+1,3,k))+2*h2*f(i,2,k);
        for l=2:m1-2
            d(l)=r1*(u(i-1,l+1,k)+u(i,l,k)+u(i+1,l+1,k)+...
            u(i,l+2,k))+r2*u(i,l+1,k)+r3*(u(i-1,l,k)+...
            u(i+1,l,k)+u(i-1,l+2,k)+u(i+1,l+2,k))+2*h2*f(i,l+1,k);
       
        end
        d(m1-1)=r*u0(i,m1+1,k)+r1*(u(i-1,m1,k)+u(i,m1-1,k)+...
            u(i+1,m1,k)+u(i,m1+1,k))+r2*u(i,m1,k)+...
            r3*(u(i-1,m1-1,k)+...
            u(i+1,m1-1,k)+u(i-1,m1+1,k)+u(i+1,m1+1,k))+2*h2*f(i,m1,k);
        for l=1:m1-2 
        a(l+1)=-a(l+1)/b(l);
        b(l+1)=b(l+1)+a(l+1)*c(l);
        d(l+1)=d(l+1)+a(l+1)*d(l);
        end
      
        u0(i,m1,k)=d(m1-1)/b(m1-1);
        for l=m1-2:-1:1
            u0(i,l+1,k)=(d(l)-c(l)*u0(i,l+2,k))/b(l);
        end     
    end
    for j=2:m1
        a=-r*ones(1,m2-1);
        c=a;a(1)=0;c(m2-1)=0;
        b=2*r4*ones(1,m2-1);
        d(1)=r*u(1,j,k+1)+2*u0(2,j,k);
        for l=2:m2-2
            d(l)=2*u0(l+1,j,k);
       
        end
        d(m2-1)=2*u0(m2,j,k)+r*u(m2+1,j,k+1);
        for l=1:m2-2 
        a(l+1)=-a(l+1)/b(l);
        b(l+1)=b(l+1)+a(l+1)*c(l);
        d(l+1)=d(l+1)+a(l+1)*d(l);
        end
        u(m2,j,k+1)=d(m2-1)/b(m2-1);   
        for l=m2-2:-1:1
            u(l+1,j,k+1)=(d(l)-c(l)*u(l+2,j,k+1))/b(l);
        end     
    end
end
for k=1:n+1
    for i=1:m2+1
        for j=1:m1+1
            p(i,j,k)=exp(1/2*(x(j)+y(i))-t(k));   
            error(i,j,k)=abs(u(i,j,k)-p(i,j,k));    
        end
    end
end
MaxErr(ii)=max(max(max(error)));
disp(MaxErr(ii));
end
for i=1:4
ord=MaxErr(i)/MaxErr(i+1);
disp(ord);
end
figure(1)
mesh(x,y,e(1:m1+1,1:m2+1,n+1));
figure(2)
mesh(x,y,p(1:m1+1,1:m2+1,n+1));

figure(3)
mesh(x,y,u(1:m1+1,1:m2+1,n+1));




